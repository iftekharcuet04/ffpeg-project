const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegStatic);

const inputVideo = 'lesson8.mp4';
const outputVideo = 'output_final_optional.mp4';
const tempSubtitleFile = 'temp_subs.ass';
const backgroundMusic = 'background_music.mp3'; 

// --- Configuration Variables (Adjust these as needed) ---
const ADD_BOX_COLOR = true;
const ADD_SUBTITLES = true;
const ADD_LOGO = true;
const ADD_BACKGROUND_MUSIC = true; 
const logoImage = 'images.jpeg';
// -------------------------------

const BOX_X = 100;
const BOX_Y = 100;
const BOX_WIDTH = 200;
const BOX_HEIGHT = 150;

const BOX_COLOR = 'red@0.7' // Simplified variables for brevity

const subtitlesData = [
    { start: 1, end: 4, text: "Optional subs are working." },
    { start: 5, end: 8, text: "Highly dynamic script now." },
];

// Function to generate a temporary .ass file (same as before)
// Function to generate a temporary .ass file dynamically
function generateAssFile(data, filename, defaultStyleOptions = {}) {
    
    // Set new default style parameters: No outline, No shadow
    const defaults = {
        fontname: 'Arial',
        fontsize: 30,
        outline: 0,     // <-- CHANGE: Default outline thickness to 0
        shadow: 0,      // <-- CHANGE: Default shadow distance to 0
        alignment: 2,   // Bottom center
        ...defaultStyleOptions // Allow user overrides for defaults
    };

    // --- Generate ASS File Header (Static part) ---
    let assContent = `[Script Info]
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${defaults.fontname},${defaults.fontsize},${defaults.primaryColor},&H000000FF,${defaults.outlineColor},${defaults.backColor},0,0,0,0,100,100,0,0.00,${defaults.borderStyle},${defaults.outline},${defaults.shadow},${defaults.alignment},10,10,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

    // --- Generate Dialogue Lines (Dynamic part) ---
    data.forEach(sub => {
        const formatTime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor(seconds % 3600 / 60);
            const s = Math.floor(seconds % 60);
            const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
        };
        const startTime = formatTime(sub.start);
        const endTime = formatTime(sub.end);
       
        // Build style override dynamically, only if the property is explicitly provided in 'sub'
        let styleOverride = '{';
        
        if (sub.size !== undefined && sub.size !== null) styleOverride += `\\fs${sub.size}`;
        if (sub.color) styleOverride += `\\c${sub.color}`;
        
        if (sub.outline !== undefined && sub.outline !== null) {
            styleOverride += `\\bord${sub.outline}`;
        }
        
        if (sub.shadow !== undefined && sub.shadow !== null) {
             styleOverride += `\\shad${sub.shadow}`;
        }

        styleOverride += '}';

        const finalOverride = styleOverride.length > 2 ? styleOverride : '';

        assContent += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${finalOverride}${sub.text}\n`;
    });

    fs.writeFileSync(filename, assContent);
}


// Check if the input video actually has audio before building filters
ffmpeg.ffprobe(inputVideo, function(err, metadata) {
    if (err) {
        console.error("Error probing input video:", err);
        return;
    }

    // Determine if an audio stream exists in the source file
    const hasOriginalAudio = metadata.streams.some(stream => stream.codec_type === 'audio');
    console.log(`Original video has audio: ${hasOriginalAudio}`);

    if (ADD_SUBTITLES) {
        generateAssFile(subtitlesData, tempSubtitleFile);
    }
    
    // Start building the command
    let command = ffmpeg(inputVideo);
    const complexFilters = [];
    let currentInputVideo = '[0:v]'; // Main video stream from Input 0
    let currentInputAudio = hasOriginalAudio ? '[0:a]' : null; // Main audio stream from Input 0, if present
    let inputIndexOffset = 1; // Index for logo, music, etc.

    // --- Add Video Filters ---
   if (ADD_BOX_COLOR) {
    const nextOutput = '[v_boxed]';
    complexFilters.push({
        filter: 'drawbox',
        options: { x: BOX_X, y: BOX_Y, w: BOX_WIDTH, h: BOX_HEIGHT, color: BOX_COLOR, t: 'fill' },
        inputs: currentInputVideo,
        outputs: nextOutput
    });
    currentInputVideo = nextOutput;
}
   if (ADD_SUBTITLES) {
    const nextOutput = '[v_subtitled]';
    complexFilters.push({
        filter: 'subtitles',
        options: tempSubtitleFile,
        inputs: currentInputVideo,
        outputs: nextOutput
    });
    currentInputVideo = nextOutput;
}
    if (ADD_LOGO) {
        command.input(logoImage);
        const logoInputIndex = inputIndexOffset++;
        complexFilters.push({
            filter: 'overlay', options: 'x=(main_w-overlay_w-10):y=10',
            inputs: [currentInputVideo, `[${logoInputIndex}:v]`], outputs: '[v_final]'
        });
        currentInputVideo = '[v_final]';
    }

    // --- Add Audio Filters (Handles 'no original audio' case) ---
    if (ADD_BACKGROUND_MUSIC && fs.existsSync(backgroundMusic)) {
        command.input(backgroundMusic).inputOptions(['-stream_loop -1']); // <-- ADD THIS LINE
        const musicInputIndex = inputIndexOffset++;
        
        // 1. Scale BGM volume first
        complexFilters.push({
            filter: 'volume', options: '0.1', inputs: `[${musicInputIndex}:a]`, outputs: '[bgm_vol]'
        });

        // 2. Decide how to integrate audio
        if (currentInputAudio) {
            // Case A: Mix original audio AND background music
            complexFilters.push({
                filter: 'amix', options: { inputs: 2, duration: 'shortest' },
                inputs: [currentInputAudio, '[bgm_vol]'],
                outputs: '[a_mixed]'
            });
            currentInputAudio = '[a_mixed]';
        } else {
            // Case B: Video has NO original audio. Just map the BGM as the main audio.
            currentInputAudio = '[bgm_vol]';
        }
    }

    // Apply all collected filters
    if (complexFilters.length > 0) {
        // fluent-ffmpeg handles mapping the final video stream ([v_final], etc.) automatically here
        command.complexFilter(complexFilters, currentInputVideo); 
    }

    // --- Configure Output Options ---
    const outputOpts = [
        '-c:a aac',       // Re-encode audio to AAC if we have an audio stream to map
        '-b:a 192k',      // Set audio bitrate
        '-shortest'       // Ensure output stops with the video duration
    ];
    
    // Explicitly map the final, processed audio stream (if one exists)
    if (currentInputAudio) {
        outputOpts.push(`-map ${currentInputAudio}`);
    } else {
        // If no audio stream is defined (no source audio, no BGM), use -an to disable audio output
        outputOpts.push('-an'); 
    }

    command.outputOptions(outputOpts);


    command.on('start', function(commandLine) {
        console.log('Spawned ffmpeg with command: ' + commandLine);
    });

    command.save(outputVideo)
      .on('error', function(err) {
        console.error('An error occurred: ' + err.message);
        if (fs.existsSync(tempSubtitleFile)) fs.unlinkSync(tempSubtitleFile);
      })
      .on('end', function() {
        console.log('Processing finished successfully! Check ' + outputVideo);
        if (fs.existsSync(tempSubtitleFile)) fs.unlinkSync(tempSubtitleFile);
      });
});
