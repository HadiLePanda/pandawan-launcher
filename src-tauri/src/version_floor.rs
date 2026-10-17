//! The newest build this machine has installed for a game and channel.
//!
//! A signature proves who published a manifest, not that it is the newest one.
//! An R2 writer can replay an old version's genuine signed pair, and `prune`
//! deliberately keeps the newest versions on the bucket, so that pair exists.
//! Signing cannot tell a replayed older build from a deliberate rollback; this
//! file is the client-side half: a build older than one already installed is
//! refused, whatever the bucket says.
//!
//! Keyed by game and channel. Alpha build 40 is a normal move down from stable
//! build 100, so a game-wide floor would refuse a deliberate channel switch.
//!
//! A legitimate rollback republishes the older binary under a higher build
//! number instead of replaying the old manifest.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::types::LauncherError;

const FLOOR_FILE: &str = "version-floors.json";

/// The newest build recorded for one game on one channel.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FloorEntry {
    pub version: String,
    pub build_number: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionFloors {
    /// `game/channel` -> the highest build installed there.
    #[serde(default)]
    pub entries: HashMap<String, FloorEntry>,
}

/// The map key for a game on a channel.
pub fn key(game_id: &str, channel: &str) -> String {
    format!("{game_id}/{channel}")
}

/// Read the floors. A missing file is empty. A corrupt one is also empty:
/// losing the floor costs the protection until the next install, and refusing
/// every install over a damaged sidecar would be worse.
pub fn load(app_data_dir: &Path) -> VersionFloors {
    std::fs::read_to_string(app_data_dir.join(FLOOR_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app_data_dir: &Path, floors: &VersionFloors) -> Result<(), LauncherError> {
    let text = serde_json::to_string_pretty(floors)
        .map_err(|e| LauncherError::Io(format!("could not encode the version floor: {e}")))?;
    std::fs::write(app_data_dir.join(FLOOR_FILE), text)?;
    Ok(())
}

pub fn floor_for<'a>(
    floors: &'a VersionFloors,
    game_id: &str,
    channel: &str,
) -> Option<&'a FloorEntry> {
    floors.entries.get(&key(game_id, channel))
}

/// Whether installing `build_number` would go backwards on that channel.
pub fn refuses(floors: &VersionFloors, game_id: &str, channel: &str, build_number: u64) -> bool {
    floor_for(floors, game_id, channel).is_some_and(|floor| build_number < floor.build_number)
}

/// Record an installed build, keeping the highest one seen. Returns whether the
/// stored value changed, so the caller only writes when there is something new.
pub fn record(
    floors: &mut VersionFloors,
    game_id: &str,
    channel: &str,
    version: &str,
    build_number: u64,
) -> bool {
    let entry = floors.entries.entry(key(game_id, channel)).or_default();
    if build_number < entry.build_number
        || (build_number == entry.build_number && !entry.version.is_empty())
    {
        return false;
    }
    entry.version = version.to_string();
    entry.build_number = build_number;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floors_with(games: &[(&str, &str, &str, u64)]) -> VersionFloors {
        let mut floors = VersionFloors::default();
        for (game_id, channel, version, build) in games {
            record(&mut floors, game_id, channel, version, *build);
        }
        floors
    }

    #[test]
    fn refuses_a_build_older_than_the_installed_one() {
        let floors = floors_with(&[("panda-quest", "stable", "1.4.0", 140)]);

        assert!(refuses(&floors, "panda-quest", "stable", 139));
        assert!(!refuses(&floors, "panda-quest", "stable", 140));
        assert!(!refuses(&floors, "panda-quest", "stable", 141));
    }

    #[test]
    fn keeps_channels_apart() {
        // Moving from stable to a younger alpha is deliberate, not a downgrade.
        let floors = floors_with(&[
            ("panda-quest", "stable", "1.4.0", 140),
            ("panda-quest", "alpha", "0.4.0", 40),
        ]);

        assert!(!refuses(&floors, "panda-quest", "alpha", 40));
        assert!(refuses(&floors, "panda-quest", "alpha", 39));
        assert!(!refuses(&floors, "panda-quest", "stable", 140));
    }

    #[test]
    fn refuses_an_unknown_game_and_channel_only_after_a_record() {
        let floors = floors_with(&[]);

        assert!(!refuses(&floors, "panda-quest", "stable", 1));

        let floors = floors_with(&[("panda-quest", "beta", "0.2.0", 20)]);
        assert!(refuses(&floors, "panda-quest", "beta", 19));
        assert!(!refuses(&floors, "panda-quest", "stable", 19));
    }

    #[test]
    fn records_only_a_higher_build() {
        let mut floors = VersionFloors::default();

        assert!(record(&mut floors, "panda-quest", "stable", "1.0.0", 100));
        assert!(!record(&mut floors, "panda-quest", "stable", "0.9.0", 90));
        assert!(!record(&mut floors, "panda-quest", "stable", "1.0.0", 100));
        assert!(record(&mut floors, "panda-quest", "stable", "1.1.0", 110));

        let floor = floor_for(&floors, "panda-quest", "stable").expect("recorded");
        assert_eq!(floor.version, "1.1.0");
        assert_eq!(floor.build_number, 110);
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let floors = floors_with(&[("panda-quest", "stable", "1.4.0", 140)]);

        save(dir.path(), &floors).expect("saved");
        assert_eq!(load(dir.path()), floors);
    }

    #[test]
    fn an_unreadable_file_reads_as_empty() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join(FLOOR_FILE), "{ not json").expect("written");

        assert_eq!(load(dir.path()), VersionFloors::default());
    }
}
