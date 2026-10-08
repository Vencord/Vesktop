use super::*;

/// Mix a track's audio stream into either the shared mixing buffer, or directly into the output
/// packet ("passthrough") when possible.
///
/// Passthrough is highest performance, but the source MUST be opus, have 20ms frames, and be the only
/// live track. In this case we copy the opus-encoded data with no changes. Otherwise, we fall back to
/// below.
///
/// There are a few functional requirements here for non-passthrough mixing that make it tricky:
/// * Input frame lengths are not congruent with what we need to send (i.e., 26.12ms in MP3 vs
///   needed 20ms).
/// * Input audio arrives at a different sample rate from required (i.e., 44.1 vs needed 48 kHz).
/// * Input data may not be `f32`s.
/// * Input data may not match stereo/mono of desired output.
///
/// All of the above challenges often happen at once. The rough pipeline in processing is:
///
/// until source end or 20 ms taken:
///   (use previous frame 'til empty / get new frame) -> [resample] -> [audio += vol * (sample as f32)]
///
/// Typically, we mix between a subset of the input packet and the output buf because the 20ms window
/// straddles packet boundaries. If there's enough space AND 48kHz AND receive f32s, then we use a fast
/// path.
///
/// In the mono -> stereo case, we duplicate across all target channels. In stereo -> mono, we average
/// the samples from each channel.
///
/// To avoid needing to hold onto resampled data longer than one mix cycle, we take enough input samples
/// to fill a chunk of the mixer (e.g., 10ms == 20ms / 2) so that they will all be used.
///
/// This is a fairly annoying piece of code to reason about, mainly because you need to hold so many
/// internal positions into: the mix buffer, resample buffers, and previous/current packets
/// for a stream.
#[inline]
pub fn mix_symph_indiv(
    // shared buffer to mix into.
    symph_mix: &mut AudioBuffer<f32>,
    // buffer to hold built up packet
    resample_scratch: &mut AudioBuffer<f32>,
    // the input stream to use
    input: &mut Parsed,
    // resampler state and positions into partially read packets
    local_state: &mut DecodeState,
    // volume of this source
    volume: f32,
    // window into the output UDP buffer to copy opus frames into.
    // This is set to `Some` IF passthrough is possible (i.e., one live source).
    mut opus_slot: Option<&mut [u8]>,
) -> (MixType, MixStatus) {
    let mut samples_written = 0;
    let mut resample_in_progress = false;
    let mut track_status = MixStatus::Live;
    let codec_type = input.decoder.codec_params().codec;

    resample_scratch.clear();

    while samples_written != MONO_FRAME_SIZE {
        // fetch a packet: either in progress, passthrough (early exit), or
        let source_packet = if local_state.inner_pos != 0 {
            Some(input.decoder.last_decoded())
        } else if let Ok(pkt) = input.format.next_packet() {
            if pkt.track_id() != input.track_id {
                continue;
            }

            let buf = pkt.buf();

            // Opus packet passthrough special case.
            if codec_type == CODEC_TYPE_OPUS && local_state.passthrough != Passthrough::Block {
                if let Some(slot) = opus_slot.as_mut() {
                    let sample_ct = if buf.is_empty() || buf.len() > i32::MAX as usize {
                        None
                    } else {
                        Some(opus2::packet::get_nb_samples(buf, SAMPLE_RATE))
                    };

                    // We don't actually block passthrough until a few violations are
                    // seen. The main one is that most Opus tracks end on a sub-20ms
                    // frame, particularly on Youtube.
                    // However, a frame that's bigger than the target buffer is an instant block.
                    let buf_size_fatal = buf.len() >= slot.len();

                    if match sample_ct {
                        Some(Ok(MONO_FRAME_SIZE)) => true,
                        _ => !local_state.record_and_check_passthrough_strike_final(buf_size_fatal),
                    } {
                        slot.write_all(buf)
                            .expect("Bounds check performed, and failure will block passthrough.");

                        return (MixType::Passthrough(buf.len()), MixStatus::Live);
                    }
                }
            }

            input
                .decoder
                .decode(&pkt)
                .map_err(|e| {
                    track_status = e.into();
                })
                .ok()
        } else {
            track_status = MixStatus::Ended;
            None
        };

        // Cleanup: failed to get the next packet, but still have to convert and mix scratch.
        if source_packet.is_none() {
            if resample_in_progress {
                // fill up remainder of buf with zeroes, resample, mix
                let (chan_c, resampler, rs_out_buf) = local_state.resampler.as_mut().unwrap();
                let in_len = resample_scratch.frames();
                let to_render = resampler.input_frames_next().saturating_sub(in_len);

                if to_render != 0 {
                    resample_scratch.render_reserved(Some(to_render));
                    for plane in resample_scratch.planes_mut().planes() {
                        for val in &mut plane[in_len..] {
                            *val = 0.0f32;
                        }
                    }
                }

                // Luckily, we make use of the WHOLE input buffer here.
                resampler
                    .process_into_buffer(
                        &resample_scratch.planes().planes()[..*chan_c],
                        rs_out_buf,
                        None,
                    )
                    .unwrap();

                // Calculate true end position using sample rate math
                let ratio = (rs_out_buf[0].len() as f32) / (resample_scratch.frames() as f32);
                let out_samples = (ratio * (in_len as f32)).round() as usize;

                mix_resampled(rs_out_buf, symph_mix, samples_written, volume);

                samples_written += out_samples;
            }

            break;
        }

        let source_packet = source_packet.unwrap();

        let in_rate = source_packet.spec().rate;
        let pkt_frames = source_packet.frames();

        if pkt_frames == 0 {
            continue;
        }

        if in_rate == SAMPLE_RATE_RAW as u32 {
            // No need to resample: mix as standard.
            let samples_marched = mix_over_ref(
                &source_packet,
                symph_mix,
                local_state.inner_pos,
                samples_written,
                volume,
            );

            samples_written += samples_marched;

            local_state.inner_pos += samples_marched;
            local_state.inner_pos %= pkt_frames;
        } else {
            // NOTE: this should NEVER change in one stream.
            let chan_c = source_packet.spec().channels.count();
            let (_, resampler, rs_out_buf) = local_state.resampler.get_or_insert_with(|| {
                // TODO: integ. error handling here.
                let resampler = FftFixedOut::new(
                    in_rate as usize,
                    SAMPLE_RATE_RAW,
                    RESAMPLE_OUTPUT_FRAME_SIZE,
                    4,
                    chan_c,
                )
                .expect("Failed to create resampler.");
                let out_buf = resampler.output_buffer_allocate(true);

                (chan_c, resampler, out_buf)
            });

            let inner_pos = local_state.inner_pos;

            let needed_in_frames = resampler.input_frames_next();
            let available_frames = pkt_frames - inner_pos;

            let force_copy = resample_in_progress || needed_in_frames > available_frames;
            if (!force_copy) && matches!(source_packet, AudioBufferRef::F32(_)) {
                // This is the only case where we can pull off a straight resample...
                // I would really like if this could be a slice of slices,
                // but the technology just isn't there yet. And I don't feel like
                // writing unsafe transformations to do so.

                // NOTE: if let needed as if-let && {bool} is nightly only.
                if let AudioBufferRef::F32(s_pkt) = source_packet {
                    let refs: Vec<&[f32]> = s_pkt
                        .planes()
                        .planes()
                        .iter()
                        .map(|s| &s[inner_pos..][..needed_in_frames])
                        .collect();

                    local_state.inner_pos += needed_in_frames;
                    local_state.inner_pos %= pkt_frames;

                    resampler
                        .process_into_buffer(&refs, rs_out_buf, None)
                        .unwrap();
                } else {
                    unreachable!()
                }
            } else {
                // We either lack enough samples, or have the wrong data format, forcing
                // a conversion/copy into the buffer.
                let old_scratch_len = resample_scratch.frames();
                let missing_frames = needed_in_frames - old_scratch_len;
                let frames_to_take = available_frames.min(missing_frames);

                resample_scratch.render_reserved(Some(frames_to_take));
                copy_into_resampler(
                    &source_packet,
                    resample_scratch,
                    inner_pos,
                    old_scratch_len,
                    frames_to_take,
                );

                local_state.inner_pos += frames_to_take;
                local_state.inner_pos %= pkt_frames;

                if resample_scratch.frames() == needed_in_frames {
                    resampler
                        .process_into_buffer(
                            &resample_scratch.planes().planes()[..chan_c],
                            rs_out_buf,
                            None,
                        )
                        .unwrap();
                    resample_scratch.clear();
                    resample_in_progress = false;
                } else {
                    // Not enough data to fill the resampler: fetch more.
                    resample_in_progress = true;
                    continue;
                }
            }

            let samples_marched = mix_resampled(rs_out_buf, symph_mix, samples_written, volume);

            samples_written += samples_marched;
        }
    }

    (MixType::MixedPcm(samples_written), track_status)
}

#[inline]
fn mix_over_ref(
    source: &AudioBufferRef<'_>,
    target: &mut AudioBuffer<f32>,
    source_pos: usize,
    dest_pos: usize,
    volume: f32,
) -> usize {
    match source {
        AudioBufferRef::U8(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::U16(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::U24(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::U32(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::S8(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::S16(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::S24(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::S32(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::F32(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
        AudioBufferRef::F64(v) => mix_symph_buffer(v, target, source_pos, dest_pos, volume),
    }
}

#[inline]
fn mix_symph_buffer<S>(
    source: &AudioBuffer<S>,
    target: &mut AudioBuffer<f32>,
    source_pos: usize,
    dest_pos: usize,
    volume: f32,
) -> usize
where
    S: Sample + IntoSample<f32>,
{
    // mix in source_packet[inner_pos..] til end of EITHER buffer.
    let src_usable = source.frames() - source_pos;
    let tgt_usable = target.frames() - dest_pos;

    let mix_ct = src_usable.min(tgt_usable);

    let target_chans = target.spec().channels.count();
    let target_mono = target_chans == 1;
    let source_chans = source.spec().channels.count();
    let source_mono = source_chans == 1;

    let source_planes = source.planes();
    let source_raw_planes = source_planes.planes();

    if source_mono {
        // mix this signal into *all* output channels at req'd volume.
        let source_plane = source_raw_planes[0];
        for d_plane in &mut (*target.planes_mut().planes()) {
            for (d, s) in d_plane[dest_pos..dest_pos + mix_ct]
                .iter_mut()
                .zip(source_plane[source_pos..source_pos + mix_ct].iter())
            {
                *d += volume * (*s).into_sample();
            }
        }
    } else if target_mono {
        // mix all signals into the one target channel: reduce aggregate volume
        // by n_channels.
        let vol_adj = 1.0 / (source_chans as f32);
        let mut t_planes = target.planes_mut();
        let d_plane = &mut *t_planes.planes()[0];
        for s_plane in source_raw_planes {
            for (d, s) in d_plane[dest_pos..dest_pos + mix_ct]
                .iter_mut()
                .zip(s_plane[source_pos..source_pos + mix_ct].iter())
            {
                *d += volume * vol_adj * (*s).into_sample();
            }
        }
    } else {
        // stereo -> stereo: don't change volume, map input -> output channels w/ no duplication
        for (d_plane, s_plane) in (*target.planes_mut().planes())
            .iter_mut()
            .zip(source_raw_planes[..].iter())
        {
            for (d, s) in d_plane[dest_pos..dest_pos + mix_ct]
                .iter_mut()
                .zip(s_plane[source_pos..source_pos + mix_ct].iter())
            {
                *d += volume * (*s).into_sample();
            }
        }
    }

    mix_ct
}

#[inline]
fn mix_resampled(
    source: &[Vec<f32>],
    target: &mut AudioBuffer<f32>,
    dest_pos: usize,
    volume: f32,
) -> usize {
    let mix_ct = source[0].len();

    let target_chans = target.spec().channels.count();
    let target_mono = target_chans == 1;
    let source_chans = source.len();
    let source_mono = source_chans == 1;

    // see `mix_symph_buffer` for explanations of stereo<->mono logic.
    if source_mono {
        let source_plane = &source[0];
        for d_plane in &mut (*target.planes_mut().planes()) {
            for (d, s) in d_plane[dest_pos..dest_pos + mix_ct]
                .iter_mut()
                .zip(source_plane)
            {
                *d += volume * s;
            }
        }
    } else if target_mono {
        let vol_adj = 1.0 / (source_chans as f32);
        let mut t_planes = target.planes_mut();
        let d_plane = &mut *t_planes.planes()[0];
        for s_plane in source {
            for (d, s) in d_plane[dest_pos..dest_pos + mix_ct].iter_mut().zip(s_plane) {
                *d += volume * vol_adj * s;
            }
        }
    } else {
        for (d_plane, s_plane) in (*target.planes_mut().planes())
            .iter_mut()
            .zip(source[..].iter())
        {
            for (d, s) in d_plane[dest_pos..dest_pos + mix_ct].iter_mut().zip(s_plane) {
                *d += volume * (*s);
            }
        }
    }

    mix_ct
}

#[inline]
pub(crate) fn copy_into_resampler(
    source: &AudioBufferRef<'_>,
    target: &mut AudioBuffer<f32>,
    source_pos: usize,
    dest_pos: usize,
    len: usize,
) -> usize {
    match source {
        AudioBufferRef::U8(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::U16(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::U24(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::U32(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::S8(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::S16(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::S24(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::S32(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::F32(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
        AudioBufferRef::F64(v) => copy_symph_buffer(v, target, source_pos, dest_pos, len),
    }
}

#[inline]
fn copy_symph_buffer<S>(
    source: &AudioBuffer<S>,
    target: &mut AudioBuffer<f32>,
    source_pos: usize,
    dest_pos: usize,
    len: usize,
) -> usize
where
    S: Sample + IntoSample<f32>,
{
    for (d_plane, s_plane) in (*target.planes_mut().planes())
        .iter_mut()
        .zip(source.planes().planes()[..].iter())
    {
        for (d, s) in d_plane[dest_pos..dest_pos + len]
            .iter_mut()
            .zip(s_plane[source_pos..source_pos + len].iter())
        {
            *d = (*s).into_sample();
        }
    }

    len
}
