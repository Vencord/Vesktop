//! Where Vesktop keeps its files on each platform, via the `directories`
//! crate (Linux: XDG, macOS: Application Support, Windows: AppData).

use directories::ProjectDirs;
use std::path::PathBuf;

fn project_dirs() -> ProjectDirs {
    ProjectDirs::from("app", "FastDiscord", "FastDiscord").expect("no home directory known to the OS")
}

pub fn settings_file() -> PathBuf {
    project_dirs().config_dir().join("settings.json")
}

pub fn data_dir() -> PathBuf {
    project_dirs().data_local_dir().to_path_buf()
}

/// Reserved for the file logger (the spotifast/zapfast pattern).
pub fn log_file() -> PathBuf {
    data_dir().join("fastdiscord.log")
}
