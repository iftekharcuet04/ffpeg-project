const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegStatic);

const inputVideo = 'lesson8.mp4';
const outputVideo = 'output_final_with_music.mp4';
const tempSubtitleFile = 'temp_subs.ass';
const backgroundMusic = 'background_music.mp3'; // <-- Add your music file path here

// --- Configuration Variables (Adjust these as needed) ---
const ADD_BOX_COLOR = true;
const ADD_SUBTITLES = true;
const ADD_LOGO = true;
const ADD_BACKGROUND_MUSIC = true; // <-- New option
const logoImage = 'images.jpeg';
// -------------------------------

const BOX_X = 100;
const BOX_Y = 100;
const BOX_WIDTH = 200;
const BOX_HEIGHT = 150;
const BOX_COLOR = 'red@0.7'

const subtitlesData = [
    { start: 1, end: 4, text: "Using the subtitles filter now.", color: "&H0000FFFF", size: 30 },
    { start: 5, end: 8, text: "This avoids font path issues.", color: "&H00FFFFFF", size: 36 },
];

// Function to generate a temporary .ass file (same as before)
function generateAssFile(data, filename) {
    let assContent = `[Script Info]
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0.00,1,2,1,2,10,10,20,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

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
       
        const styleOverride = `{\\fs${sub.size}\\c${sub.color}}`;

        assContent += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${styleOverride}${sub.text}\n`;
    });

    fs.writeFileSync(filename, assContent);
}

// Generate the file before running ffmpeg
if (ADD_SUBTITLES) {
    generateAssFile(subtitlesData, tempSubtitleFile);
}


// --- Build and Run Command using dynamic filter array with explicit names ---

let command = ffmpeg(inputVideo);
const complexFilters = [];
let currentInputVideo = '[0:v]'; // Start with the main video input
let currentInputAudio = '[0:a]'; // Start with the main audio input (Input index 0)
let inputIndexOffset = 1; // Index for additional inputs (logo, music)

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
    const nextOutput = '[v_final]';
    complexFilters.push({
        filter: 'overlay',
        options: 'x=(main_w-overlay_w-10):y=10',
        inputs: [currentInputVideo, `[${logoInputIndex}:v]`],
        outputs: nextOutput
    });
    currentInputVideo = nextOutput;
}

if (ADD_BACKGROUND_MUSIC) {
    command.input(backgroundMusic);
    const musicInputIndex = inputIndexOffset++;
    const nextAudioOutput = '[a_mixed]';

    // Optional: Adjust the volume of the background music (0.1 = 10%)
    const bgmVolumeFilter = {
        filter: 'volume',
        options: '0.1', 
        inputs: `[${musicInputIndex}:a]`,
        outputs: '[bgm_vol]'
    };
    complexFilters.push(bgmVolumeFilter);
    
    // Mix the original audio stream and the background music stream
    complexFilters.push({
        filter: 'amix',
        options: { inputs: 2, duration: 'shortest' }, // duration 'shortest' stops when video ends
        inputs: [currentInputAudio, '[bgm_vol]'],
        outputs: nextAudioOutput
    });
    currentInputAudio = nextAudioOutput; // Update the main audio input for mapping
}

// Apply all collected filters at once
if (complexFilters.length > 0) {
    // We only pass the final video output name here to let fluent-ffmpeg manage the filter graph
    command.complexFilter(complexFilters, currentInputVideo); 
}

command.outputOptions([
    '-c:a aac',  // Re-encode audio to AAC (amix requires re-encoding)
    '-b:a 192k', // Set audio bitrate
    `-map ${currentInputAudio}` // Map the final, filtered audio stream
]);

// If using background music, use -shortest to end the output when the video ends
if (ADD_BACKGROUND_MUSIC) {
    command.outputOptions('-shortest');
}


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
