use symphonia_core::{formats::SeekTo, units::Time};

// SeekTo lacks Copy and Clone... somehow.
pub fn copy_seek_to(pos: &SeekTo) -> SeekTo {
    match *pos {
        SeekTo::Time { time, track_id } => SeekTo::Time { time, track_id },
        SeekTo::TimeStamp { ts, track_id } => SeekTo::TimeStamp { ts, track_id },
    }
}

pub fn seek_to_is_zero(pos: &SeekTo) -> bool {
    match *pos {
        SeekTo::Time { time, .. } =>
            time == Time {
                seconds: 0,
                frac: 0.0,
            },
        SeekTo::TimeStamp { ts, .. } => ts == 0,
    }
}
