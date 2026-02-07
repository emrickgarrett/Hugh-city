"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";

// Music genres and their tracks
type MusicGenre = "chill" | "jazz";

const MUSIC_PLAYLISTS: Record<MusicGenre, string[]> = {
  chill: [
    "chill_1.mp3",
    "chill_2.mp3",
    "chill_3.mp3",
  ],
  jazz: [
    "hugh-city_music_001.mp3",
    "hugh-city_music_002.mp3",
    "hugh-city_music_003.mp3",
    "hugh-city_music_004.mp3",
    "hugh-city_music_005.mp3",
    "hugh-city_music_006.mp3",
    "hugh-city_music_007.mp3",
  ],
};

// Gray color scheme for music player
const GRAY_COLORS = {
  bg: "#5a5a5a",
  bgActive: "#3a3a3a",
  borderLight: "#7a7a7a",
  borderDark: "#3a3a3a",
  shadow: "#2a2a2a",
};

const getTrackPath = (genre: MusicGenre, index: number) =>
  `/audio/music/${genre}/${MUSIC_PLAYLISTS[genre][index]}`;

// Helper to create the audio element (runs once during ref init, not in an effect)
function createAudioElement(): HTMLAudioElement {
  if (typeof window === "undefined") return null as unknown as HTMLAudioElement;
  const audio = new Audio();
  audio.volume = 0.3;
  audio.preload = "auto";
  return audio;
}

// Button component — defined OUTSIDE MusicPlayer to avoid remounting on every render
function MenuButton({
  onClick,
  title,
  imgSrc,
  active = false,
}: {
  onClick: () => void;
  title: string;
  imgSrc: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? GRAY_COLORS.bgActive : GRAY_COLORS.bg,
        border: "2px solid",
        borderColor: active
          ? `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`
          : `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
        padding: 0,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 0,
        borderTopWidth: 0,
        boxShadow: active ? `inset 1px 1px 0px ${GRAY_COLORS.shadow}` : `1px 1px 0px ${GRAY_COLORS.shadow}`,
        imageRendering: "pixelated",
        transition: "filter 0.1s",
        transform: active ? "translate(1px, 1px)" : "none",
      }}
      onMouseEnter={(e) => !active && (e.currentTarget.style.filter = "brightness(1.1)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      onMouseDown={(e) => {
        if (active) return;
        e.currentTarget.style.filter = "brightness(0.9)";
        e.currentTarget.style.borderColor = `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`;
        e.currentTarget.style.transform = "translate(1px, 1px)";
        e.currentTarget.style.boxShadow = `inset 1px 1px 0px ${GRAY_COLORS.shadow}`;
      }}
      onMouseUp={(e) => {
        if (active) return;
        e.currentTarget.style.filter = "brightness(1.1)";
        e.currentTarget.style.borderColor = `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`;
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = `1px 1px 0px ${GRAY_COLORS.shadow}`;
      }}
    >
      <img
        src={imgSrc}
        alt={title}
        style={{
          width: 48,
          height: 48,
          display: "block",
        }}
      />
    </button>
  );
}

// Music player component styled like top menu buttons
interface MusicPlayerProps {
  onTrackPlay?: (genre: string, trackIndex: number) => void;
  musicVolume?: number; // 0–1, effective volume (master * music)
}

export default function MusicPlayer({ onTrackPlay, musicVolume = 1 }: MusicPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentGenre, setCurrentGenre] = useState<MusicGenre>("chill");
  const [currentTrack, setCurrentTrack] = useState(0);
  // Audio element created eagerly (not in useEffect) so it's available immediately
  const audioRef = useRef<HTMLAudioElement>(createAudioElement());
  // Track whether the user wants music playing (survives track changes)
  const wantsPlayingRef = useRef(false);
  // Stable ref for track play callback (avoids useCallback dep issues)
  const onTrackPlayRef = useRef(onTrackPlay);
  onTrackPlayRef.current = onTrackPlay;

  const currentPlaylist = MUSIC_PLAYLISTS[currentGenre];

  // Sync music volume when prop changes
  useEffect(() => {
    audioRef.current.volume = 0.3 * musicVolume;
  }, [musicVolume]);

  // Cleanup audio on unmount
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // Load and play a specific track
  const loadTrack = useCallback((genre: MusicGenre, trackIndex: number, autoplay: boolean) => {
    const audio = audioRef.current;

    // Pause current playback
    audio.pause();
    setIsLoading(autoplay);
    setIsPlaying(false);

    // Set the new source
    audio.src = getTrackPath(genre, trackIndex);
    audio.load();

    if (autoplay) {
      // Wait for enough data to be buffered before playing
      const onCanPlay = () => {
        audio.removeEventListener("canplaythrough", onCanPlay);
        audio.removeEventListener("error", onError);
        // Only play if user still wants music (didn't click pause while loading)
        if (wantsPlayingRef.current) {
          audio.play().then(() => {
            setIsPlaying(true);
            setIsLoading(false);
            onTrackPlayRef.current?.(genre, trackIndex);
          }).catch(() => {
            setIsPlaying(false);
            setIsLoading(false);
          });
        } else {
          setIsLoading(false);
        }
      };

      const onError = () => {
        audio.removeEventListener("canplaythrough", onCanPlay);
        audio.removeEventListener("error", onError);
        setIsPlaying(false);
        setIsLoading(false);
      };

      audio.addEventListener("canplaythrough", onCanPlay, { once: true });
      audio.addEventListener("error", onError, { once: true });
    }
  }, []);

  // Handle track ended — advance to next
  useEffect(() => {
    const audio = audioRef.current;

    const handleEnded = () => {
      const nextIndex = (currentTrack + 1) % currentPlaylist.length;
      setCurrentTrack(nextIndex);
      loadTrack(currentGenre, nextIndex, true);
    };

    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("ended", handleEnded);
    };
  }, [currentTrack, currentGenre, currentPlaylist.length, loadTrack]);

  // Pre-load initial track source (no autoplay)
  useEffect(() => {
    const audio = audioRef.current;
    audio.src = getTrackPath("chill", 0);
    audio.load();
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;

    if (isPlaying || isLoading) {
      // Stop playback
      audio.pause();
      wantsPlayingRef.current = false;
      setIsPlaying(false);
      setIsLoading(false);
    } else {
      // Start playback
      wantsPlayingRef.current = true;
      // If audio is already loaded (has buffered data), play immediately
      if (audio.readyState >= 3) {
        audio.play().then(() => {
          setIsPlaying(true);
          onTrackPlayRef.current?.(currentGenre, currentTrack);
        }).catch(() => {
          setIsPlaying(false);
        });
      } else {
        // Need to load/buffer first
        loadTrack(currentGenre, currentTrack, true);
      }
    }
    playClickSound();
  }, [isPlaying, isLoading, currentGenre, currentTrack, loadTrack]);

  const nextTrack = useCallback(() => {
    const nextIndex = (currentTrack + 1) % currentPlaylist.length;
    setCurrentTrack(nextIndex);
    loadTrack(currentGenre, nextIndex, wantsPlayingRef.current);
    playClickSound();
  }, [currentTrack, currentPlaylist.length, currentGenre, loadTrack]);

  const prevTrack = useCallback(() => {
    const prevIndex = (currentTrack - 1 + currentPlaylist.length) % currentPlaylist.length;
    setCurrentTrack(prevIndex);
    loadTrack(currentGenre, prevIndex, wantsPlayingRef.current);
    playClickSound();
  }, [currentTrack, currentPlaylist.length, currentGenre, loadTrack]);

  const switchGenre = useCallback((genre: MusicGenre) => {
    if (genre !== currentGenre) {
      setCurrentGenre(genre);
      setCurrentTrack(0);
      loadTrack(genre, 0, wantsPlayingRef.current);
      playDoubleClickSound();
    }
  }, [currentGenre, loadTrack]);

  const genreIcon = currentGenre === "chill" ? "/UI/ambient.png" : "/UI/jazz.png";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        borderTop: `2px solid ${GRAY_COLORS.borderLight}`,
        boxShadow: `inset 0 2px 0px ${GRAY_COLORS.borderLight}`,
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Genre selector button */}
      <div style={{ position: "relative", display: "inline-block" }}>
        <MenuButton
          onClick={() => {}}
          title="Select Music Genre"
          imgSrc={genreIcon}
        />
        <select
          value={currentGenre}
          onChange={(e) => switchGenre(e.target.value as MusicGenre)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          <option value="chill">Chill</option>
          <option value="jazz">Jazz</option>
        </select>
      </div>

      {/* Playback controls */}
      <MenuButton
        onClick={prevTrack}
        title="Previous Song"
        imgSrc="/UI/lastsong.png"
      />
      <MenuButton
        onClick={togglePlay}
        title={isLoading ? "Loading..." : isPlaying ? "Pause" : "Play"}
        imgSrc={isPlaying || isLoading ? "/UI/pause.png" : "/UI/play.png"}
        active={isPlaying || isLoading}
      />
      <MenuButton
        onClick={nextTrack}
        title="Next Song"
        imgSrc="/UI/nextsong.png"
      />

      {/* Song name display with marquee */}
      <div
        style={{
          background: GRAY_COLORS.bg,
          border: "2px solid",
          borderColor: `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
          borderTopWidth: 0,
          padding: "4px",
          minWidth: 180,
          maxWidth: 220,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `1px 1px 0px ${GRAY_COLORS.shadow}`,
          overflow: "hidden",
        }}
      >
        {/* Inner inset panel */}
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: "4px 8px",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            position: "relative",
            background: "#000000",
            border: "1px solid",
            borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
          }}
        >
          <div
            key={`${currentGenre}-${currentTrack}`}
            style={{
              color: isLoading ? "#888800" : isPlaying ? "#00ff00" : "#00cc00",
              fontSize: 18,
              fontWeight: "700",
              fontFamily: "var(--font-pixelify), monospace",
              whiteSpace: "nowrap",
              textShadow: "2px 2px 0 rgba(0, 0, 0, 0.9)",
              animation: "marquee 10s linear infinite",
              display: "inline-block",
              paddingLeft: "100%",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            {isLoading
              ? `LOADING... ${currentTrack + 1}. ${currentGenre}_${currentPlaylist[currentTrack]}`.toUpperCase()
              : `${currentTrack + 1}. ${currentGenre}_${currentPlaylist[currentTrack]}`.toUpperCase()
            } • {`${currentTrack + 1}. ${currentGenre}_${currentPlaylist[currentTrack]}`.toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}
