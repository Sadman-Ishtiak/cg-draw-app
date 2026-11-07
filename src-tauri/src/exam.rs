// exam.rs — CGEX1 encrypted exam-save format and the 8-hour reopen window.
//
// File layout:  "CGEX1\n" || base64( blob ) || "\n"
//   blob = salt(16) || created_at(8, u64 BE, unix seconds) || salt_i(16)
//        || wrap_student(60)      nonce(12) + content_key(32) + tag(16),
//                                 key = PBKDF2-HMAC-SHA256(student_pass, salt, 100k)
//        || wrap_instructor(60)   same construction, key = session instructor key (IS)
//        || wrap_pass(60)         same construction, key = PBKDF2(instructor_pass, salt_i),
//                                 payload = IS  (recovers IS from the passphrase)
//        || body                  nonce(12) + AES-256-GCM(manifest json) + tag(16),
//                                 key = content key C
//   manifest = [[filename, source], ...]
//
// Two decrypt paths (plan §6):
//   student    passphrase -> C, refused after 8 h from created_at
//              (6 h exam + 2 h buffer; crash recovery, not archival).
//   instructor passphrase -> IS -> C, NO time gate (grading anytime).
//              The instructor passphrase itself is never stored in the app or
//              on disk: only its PBKDF2 wrap of IS travels inside the file.
//
// The session key IS is generated at exam start and kept in the local exam
// config (the exam machine) so autosaves keep carrying the instructor wrap
// across app restarts. That is the same accepted threat model as the student
// passphrase living in the config: app-level deterrence, not proof.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine as _;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

pub const MAGIC: &str = "CGEX1\n";
pub const WINDOW_SECS: u64 = 8 * 60 * 60;
const PBKDF2_ROUNDS: u32 = 100_000;
const WRAP_LEN: usize = 12 + 32 + 16; // nonce + key + GCM tag

// Sizes of the fixed prefix inside the blob.
pub const BLOB_HEADER: usize = 16 + 8 + 16 + 3 * WRAP_LEN;

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut v = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut v);
    v
}

fn derive_wrap_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ROUNDS, &mut out);
    out
}

fn seal(key: &[u8; 32], plaintext: &[u8]) -> Vec<u8> {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .expect("encrypt with fresh nonce cannot fail");
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    out
}

fn unseal(key: &[u8; 32], data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 12 + 16 {
        return None;
    }
    let (nonce, ct) = data.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher.decrypt(Nonce::from_slice(nonce), ct).ok()
}

/// What the caller must carry between saves so the instructor wrap survives
/// app restarts: the session key IS plus the instructor-passphrase wrap of it.
#[derive(Clone)]
pub struct InstructorWrap {
    pub session_key: [u8; 32], // IS (kept in the exam config, never in the file)
    pub salt_i: Vec<u8>,       // 16 B salt for the instructor PBKDF2
    pub wrap_pass: Vec<u8>,    // seal(PBKDF2(instructor_pass, salt_i), IS)
}

pub fn new_instructor_wrap(instructor_pass: &str) -> InstructorWrap {
    let mut session_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut session_key);
    let salt_i = random_bytes(16);
    let wk = derive_wrap_key(instructor_pass, &salt_i);
    let wrap_pass = seal(&wk, &session_key);
    InstructorWrap { session_key, salt_i, wrap_pass }
}

pub fn encrypt_exam(
    files: &[(String, String)],
    student_pass: &str,
    instructor: &InstructorWrap,
) -> Result<Vec<u8>, String> {
    if files.is_empty() {
        return Err("no files to save".into());
    }
    if instructor.salt_i.len() != 16 || instructor.wrap_pass.len() != WRAP_LEN {
        return Err("corrupted instructor wrap".into());
    }
    let salt = random_bytes(16);
    let mut content_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut content_key);
    let created = now_secs();
    let manifest = serde_json::to_vec(files).map_err(|e| e.to_string())?;

    let mut blob = Vec::new();
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&created.to_be_bytes());
    blob.extend_from_slice(&instructor.salt_i);
    let wk = derive_wrap_key(student_pass, &salt);
    blob.extend_from_slice(&seal(&wk, &content_key));
    blob.extend_from_slice(&seal(&instructor.session_key, &content_key));
    blob.extend_from_slice(&instructor.wrap_pass);
    blob.extend_from_slice(&seal(&content_key, &manifest));

    let mut file = Vec::new();
    file.extend_from_slice(MAGIC.as_bytes());
    file.extend_from_slice(base64::engine::general_purpose::STANDARD.encode(&blob).as_bytes());
    file.push(b'\n');
    Ok(file)
}

/// `instructor_pass` set -> instructor path (no time gate).
/// Otherwise the student path: passphrase + the 8 h window.
pub fn decrypt_exam(
    bytes: &[u8],
    student_pass: &str,
    instructor_pass: Option<&str>,
    now: u64,
) -> Result<Vec<(String, String)>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "not an exam file")?;
    let rest = text.strip_prefix(MAGIC).ok_or("not an exam file")?;
    let blob = base64::engine::general_purpose::STANDARD
        .decode(rest.trim())
        .map_err(|_| "corrupted exam file".to_string())?;
    if blob.len() < BLOB_HEADER + 12 + 16 {
        return Err("corrupted exam file".into());
    }
    let mut off = 0;
    let salt = &blob[off..off + 16];
    off += 16;
    let created = u64::from_be_bytes(blob[off..off + 8].try_into().unwrap());
    off += 8;
    let salt_i = &blob[off..off + 16];
    off += 16;
    let wrap_student = &blob[off..off + WRAP_LEN];
    off += WRAP_LEN;
    let wrap_instructor = &blob[off..off + WRAP_LEN];
    off += WRAP_LEN;
    let wrap_pass = &blob[off..off + WRAP_LEN];
    off += WRAP_LEN;
    let body = &blob[off..];

    let content_key: [u8; 32] = match instructor_pass {
        Some(ipass) => {
            // Instructor path: passphrase -> IS -> C. No time window.
            let wk = derive_wrap_key(ipass, salt_i);
            let is: [u8; 32] = unseal(&wk, wrap_pass)
                .ok_or("invalid instructor passphrase")?
                .try_into()
                .map_err(|_| "corrupted exam file".to_string())?;
            unseal(&is, wrap_instructor)
                .ok_or("corrupted exam file")?
                .try_into()
                .map_err(|_| "corrupted exam file".to_string())?
        }
        None => {
            // Student path: refused once the 8 h window has passed.
            if now > created + WINDOW_SECS {
                return Err(
                    "this exam save has expired (reopen window is 8 hours after the exam started)"
                        .into(),
                );
            }
            let wk = derive_wrap_key(student_pass, salt);
            unseal(&wk, wrap_student)
                .ok_or("invalid passphrase")?
                .try_into()
                .map_err(|_| "corrupted exam file".to_string())?
        }
    };

    let manifest = unseal(&content_key, body).ok_or("corrupted exam file")?;
    serde_json::from_slice(&manifest).map_err(|_| "corrupted exam file".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files() -> Vec<(String, String)> {
        vec![
            ("rollno_exam.cpp".into(), "int main() { return 42; }".into()),
            ("notes.txt".into(), "rough work".into()),
        ]
    }

    #[test]
    fn student_roundtrip_and_wrong_pass() {
        let iw = new_instructor_wrap("te@cher-pass");
        let data = encrypt_exam(&files(), "s3cret", &iw).unwrap();
        let got = decrypt_exam(&data, "s3cret", None, now_secs()).unwrap();
        assert_eq!(got, files());
        assert!(decrypt_exam(&data, "wrong", None, now_secs()).is_err());
        assert!(data.starts_with(MAGIC.as_bytes()));
    }

    #[test]
    fn instructor_decrypt_after_window_without_student_pass() {
        let iw = new_instructor_wrap("grading-pass");
        let data = encrypt_exam(&files(), "s3cret", &iw).unwrap();
        // far future: the student path must refuse, the instructor path must not
        let now = now_secs() + 100 * 24 * 3600;
        assert!(decrypt_exam(&data, "s3cret", None, now).is_err());
        let got = decrypt_exam(&data, "", Some("grading-pass"), now).unwrap();
        assert_eq!(got, files());
        assert!(decrypt_exam(&data, "", Some("nope"), now).is_err());
    }

    #[test]
    fn student_refused_after_8h_with_clear_error() {
        let iw = new_instructor_wrap("p");
        let data = encrypt_exam(&files(), "pass", &iw).unwrap();
        let err = decrypt_exam(&data, "pass", None, now_secs() + WINDOW_SECS + 1).unwrap_err();
        assert!(err.contains("expired"), "got: {}", err);
        // exactly at the boundary it is still open (created_at read from the file)
        let b64 = std::str::from_utf8(&data).unwrap()
            .strip_prefix(MAGIC).unwrap().trim().to_string();
        let blob = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let created = u64::from_be_bytes(blob[16..24].try_into().unwrap());
        decrypt_exam(&data, "pass", None, created + WINDOW_SECS).unwrap();
        assert!(decrypt_exam(&data, "pass", None, created + WINDOW_SECS + 1).is_err());
    }

    #[test]
    fn manifest_is_all_tabs_single_file() {
        let iw = new_instructor_wrap("p");
        let many: Vec<(String, String)> = (0..7)
            .map(|i| (format!("file{}.cpp", i), format!("int f{}() {{ return {}; }}", i, i)))
            .collect();
        let data = encrypt_exam(&many, "pass", &iw).unwrap();
        assert_eq!(decrypt_exam(&data, "pass", None, now_secs()).unwrap(), many);
    }

    #[test]
    fn every_save_has_fresh_content_key_but_stable_instructor_wrap() {
        let iw = new_instructor_wrap("p");
        let a = encrypt_exam(&files(), "pass", &iw).unwrap();
        let b = encrypt_exam(&files(), "pass", &iw).unwrap();
        assert_ne!(a, b, "content key + salt must be random per save");
        // and a second InstructorWrap from the same passphrase must still decrypt
        let iw2 = new_instructor_wrap("p");
        let c = encrypt_exam(&files(), "pass", &iw2).unwrap();
        decrypt_exam(&c, "pass", None, now_secs()).unwrap();
        decrypt_exam(&c, "", Some("p"), now_secs()).unwrap();
    }

    #[test]
    fn corrupted_files_are_rejected() {
        let iw = new_instructor_wrap("p");
        let data = encrypt_exam(&files(), "pass", &iw).unwrap();
        assert!(decrypt_exam(b"nope", "pass", None, now_secs()).is_err());
        let mut cut = data.clone();
        cut.truncate(cut.len() / 2);
        assert!(decrypt_exam(&cut, "pass", None, now_secs()).is_err());
        let mut flipped = data.clone();
        let last = flipped.len() - 2;
        flipped[last] ^= 0xFF;
        assert!(decrypt_exam(&flipped, "pass", None, now_secs()).is_err());
    }

    #[test]
    fn empty_save_rejected() {
        let iw = new_instructor_wrap("p");
        assert!(encrypt_exam(&[], "pass", &iw).is_err());
    }
}
