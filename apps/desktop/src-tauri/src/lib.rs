use std::{fs::File, io::{Read, Seek, SeekFrom}, path::PathBuf};
use sha2::{Digest, Sha256};
use tauri::Manager;

fn audio_path(path: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if !["mp3", "m4a", "m4b", "ogg", "opus", "flac", "wav", "aac", "wma"].contains(&ext.as_str()) || !path.is_file() {
        return Err("Expected a local audio file".into());
    }
    Ok(path)
}

#[tauri::command]
fn authorize_audio(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope().allow_file(audio_path(&path)?).map_err(|e| e.to_string())
}

// Metadata parsers can seek past the audio payload without copying it into JS.
#[tauri::command]
fn read_audio_range(path: String, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    if length > 1024 * 1024 { return Err("Read exceeds 1 MiB".into()); }
    let mut file = File::open(audio_path(&path)?).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut data = vec![0; length];
    let mut filled = 0;
    while filled < length {
        let n = file.read(&mut data[filled..]).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        filled += n;
    }
    data.truncate(filled);
    Ok(data)
}

fn hash_reader(mut reader: impl Read) -> Result<String, String> {
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[tauri::command]
async fn fingerprint_audio(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        hash_reader(File::open(audio_path(&path)?).map_err(|e| e.to_string())?)
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![authorize_audio, read_audio_range, fingerprint_audio])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sha256_known_vector() {
        assert_eq!(hash_reader(&b"abc"[..]).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
    #[test]
    fn range_is_bounded() {
        assert!(read_audio_range("missing.mp3".into(), 0, 1024 * 1024 + 1).unwrap_err().contains("1 MiB"));
    }
}
