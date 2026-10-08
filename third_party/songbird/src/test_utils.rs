#![allow(missing_docs)]

use byteorder::{LittleEndian, WriteBytesExt};
use std::mem;

#[must_use]
pub fn make_sine(float_len: usize, stereo: bool) -> Vec<u8> {
    let sample_len = mem::size_of::<f32>();
    let byte_len = float_len * sample_len;

    // set period to 100 samples == 480Hz sine.

    let mut out = vec![0u8; byte_len];
    let mut byte_slice = &mut out[..];

    for i in 0..float_len {
        let x_val = (i as f32) * 50.0 / std::f32::consts::PI;
        byte_slice.write_f32::<LittleEndian>(x_val.sin()).unwrap();
    }

    if stereo {
        let mut new_out = vec![0u8; byte_len * 2];

        for (mono_chunk, stereo_chunk) in out[..]
            .chunks(sample_len)
            .zip(new_out[..].chunks_mut(2 * sample_len))
        {
            stereo_chunk[..sample_len].copy_from_slice(mono_chunk);
            stereo_chunk[sample_len..].copy_from_slice(mono_chunk);
        }

        new_out
    } else {
        out
    }
}

#[must_use]
pub fn make_pcm_sine(i16_len: usize, stereo: bool) -> Vec<u8> {
    let sample_len = mem::size_of::<i16>();
    let byte_len = i16_len * sample_len;

    // set period to 100 samples == 480Hz sine.
    // amplitude = 10_000

    let mut out = vec![0u8; byte_len];
    let mut byte_slice = &mut out[..];

    for i in 0..i16_len {
        let x_val = (i as f32) * 50.0 / std::f32::consts::PI;
        byte_slice
            .write_i16::<LittleEndian>((x_val.sin() * 10_000.0) as i16)
            .unwrap();
    }

    if stereo {
        let mut new_out = vec![0u8; byte_len * 2];

        for (mono_chunk, stereo_chunk) in out[..]
            .chunks(sample_len)
            .zip(new_out[..].chunks_mut(2 * sample_len))
        {
            stereo_chunk[..sample_len].copy_from_slice(mono_chunk);
            stereo_chunk[sample_len..].copy_from_slice(mono_chunk);
        }

        new_out
    } else {
        out
    }
}
