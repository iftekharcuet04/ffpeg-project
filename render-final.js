const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');


// Function to generate a temporary .ass file dynamically
function generateAssFile(data, filename, styleDefaults = {}) {
    const defaults = {
        fontname: 'Arial', fontsize: 30,  outline: 0, shadow: 0, alignment: 2,
        playResX: 1280, playResY: 720, ...styleDefaults
    };
    let assContent = `[Script Info]\nPlayResX: ${defaults.playResX}\nPlayResY: ${defaults.playResY}\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${defaults.fontname},${defaults.fontsize},${defaults.primaryColor},&H000000FF,${defaults.outlineColor},${defaults.backColor},0,0,0,0,100,100,0,0.00,${defaults.borderStyle},${defaults.outline},${defaults.shadow},${defaults.alignment},10,10,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    data.forEach(sub => {
        const formatTime = (seconds) => {
            const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60);
            const s = Math.floor(seconds % 60); const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
        };
        const startTime = formatTime(sub.start); const endTime = formatTime(sub.end);
        let styleOverride = '{';
        if (sub.size !== undefined && sub.size !== null) styleOverride += `\\fs${sub.size}`; 
        if (sub.color) styleOverride += `\\c${sub.color}`;
        if (sub.outline !== undefined && sub.outline !== null) styleOverride += `\\bord${sub.outline}`;
        if (sub.shadow !== undefined && sub.shadow !== null) styleOverride += `\\shad${sub.shadow}`;
        styleOverride += '}';
        const finalOverride = styleOverride.length > 2 ? styleOverride : '';
        assContent += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${finalOverride}${sub.text}\n`;
    });
    fs.writeFileSync(filename, assContent);
}
// --- End Helper Functions ---


function processVideo(config) {
    const {
        inputVideo,
        outputVideo,
        subtitleFile,
        backgroundMusic,
        logoImage,
        subtitlesData,
        boxOptions,
        mainVideoVolume = 1.0,
        backgroundMusicVolume = 0.3,
        videoWidth=1280, // Provided by caller (Target/Source Width)
        videoHeight=720, // Provided by caller (Target/Source Height)
        fitMode = 'crop'
    } = config;

    const tempSubtitleFile = subtitleFile;

     const finalWidth = Math.floor(videoWidth / 2) * 2;
    const finalHeight = Math.floor(videoHeight / 2) * 2;

    

    ffmpeg.ffprobe(inputVideo, (err, metadata) => {
        if (err) { console.error("Error probing input video:", err); return; }
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const sourceWidth = videoStream.width;
        const sourceHeight = videoStream.height;
        const hasOriginalAudio = metadata.streams.some(stream => {console.log(stream.codec_type); return stream.codec_type === 'audio'});
       console.log("hasOriginalAudio", hasOriginalAudio);
        const useSubtitles = subtitlesData && subtitlesData.length > 0;
        if (useSubtitles) {
            console.log('Generating temporary .ass file...', tempSubtitleFile);
            generateAssFile(subtitlesData, tempSubtitleFile, { playResX: finalWidth, playResY: finalHeight });
        }
        
        let command = ffmpeg(inputVideo);
        const complexFilters = [];
        let currentInputVideo = '[0:v]';
        let currentInputAudio = hasOriginalAudio ? '[0:a]' : null;
        let inputIndexOffset = 1;

       // --- DYNAMIC SCALING AND CROPPING/PADDING LOGIC (using final even dimensions) ---
        const sourceAspectRatio = sourceWidth / sourceHeight;
        const targetAspectRatio = finalWidth / finalHeight;
        
        let scaleFilter = '';
        let cropFilter = '';
        let padFilter = '';

        if (fitMode === 'crop') {
            // CROP: Scale to fill the frame completely (increase aspect ratio)
            if (sourceAspectRatio > targetAspectRatio) {
                // Source is wider than target, scale height to match target height, width will be excess
                const scaledWidth = Math.floor((finalHeight * sourceAspectRatio) / 2) * 2;
                const xCrop = Math.floor(((scaledWidth - finalWidth) / 2) / 2) * 2; // Center X offset
                scaleFilter = `${scaledWidth}:${finalHeight}`;
                cropFilter = `${finalWidth}:${finalHeight}:${xCrop}:0`;
            } else {
                // Source is taller than target, scale width to match target width, height will be excess
                const scaledHeight = Math.floor((finalWidth / sourceAspectRatio) / 2) * 2;
                const yCrop = Math.floor(((scaledHeight - finalHeight) / 2) / 2) * 2; // Center Y offset
                scaleFilter = `${finalWidth}:${scaledHeight}`;
                cropFilter = `${finalWidth}:${finalHeight}:0:${yCrop}`;
            }
        } else {
            // PAD: Scale to fit inside the frame (decrease aspect ratio)
            padFilter = `${finalWidth}:${finalHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;
            scaleFilter = `${finalWidth}:${finalHeight}:force_original_aspect_ratio=decrease`;
        }

        // Apply the calculated filters
        if (fitMode === 'crop') {
             complexFilters.push({ filter: 'scale', options: scaleFilter, inputs: currentInputVideo, outputs: '[v_temp_scaled]' });
             complexFilters.push({ filter: 'crop', options: `${cropFilter},setsar=1`, inputs: '[v_temp_scaled]', outputs: '[v_fitted]' });
        } else {
             complexFilters.push({ filter: 'scale', options: scaleFilter, inputs: currentInputVideo, outputs: '[v_temp_scaled]' });
             complexFilters.push({ filter: 'pad', options: `${padFilter},setsar=1`, inputs: '[v_temp_scaled]', outputs: '[v_fitted]' });
        }
        currentInputVideo = '[v_fitted]';

        // --- Build Video Filters (Use the scaled input stream) ---
        if (boxOptions) {
            const nextOutput = '[v_boxed]';
            complexFilters.push({ filter: 'drawbox', options: boxOptions, inputs: currentInputVideo, outputs: nextOutput });
            currentInputVideo = nextOutput;
        }
        if (useSubtitles) {
            const nextOutput = '[v_subtitled]';
            complexFilters.push({ filter: 'subtitles', options: tempSubtitleFile, inputs: currentInputVideo, outputs: nextOutput });
            currentInputVideo = nextOutput;
        }
        if (logoImage && fs.existsSync(logoImage)) {
            command.input(logoImage);
            const logoInputIndex = inputIndexOffset++;
            complexFilters.push({ filter: 'overlay', options: 'x=(main_w-overlay_w-10):y=10', inputs: [currentInputVideo, `[${logoInputIndex}:v]`], outputs: '[v_final]' });
            currentInputVideo = '[v_final]';
        }

        // --- Build Audio Filters ---
        const hasBackgroundMusic = backgroundMusic && fs.existsSync(backgroundMusic);

            // --- Force original audio into the filter graph if it exists ---
            if (currentInputAudio) {
                // Use an 'identity' filter so we can map its output explicitly later
                complexFilters.push({ filter: 'anull', inputs: currentInputAudio, outputs: '[a_base]' });
                currentInputAudio = '[a_base]'; 
            }

            // --- Apply Volume Filter to Base Audio ---
            if (currentInputAudio && Math.abs(mainVideoVolume - 1.0) > 0.0001) {
                const nextAudioOutput = '[a_main_vol]';
                complexFilters.push({ filter: 'volume', options: mainVideoVolume.toString(), inputs: currentInputAudio, outputs: nextAudioOutput });
                currentInputAudio = nextAudioOutput;
            }
            
            // --- Apply Background Music (Amix) ---
            if (hasBackgroundMusic) {
                command.input(backgroundMusic).inputOptions(['-stream_loop -1']); 
                const musicInputIndex = inputIndexOffset++;
                const bgmVolumeOutput = '[bgm_vol]';
                complexFilters.push({ filter: 'volume', options: backgroundMusicVolume.toString(), inputs: `[${musicInputIndex}:a]`, outputs: bgmVolumeOutput });
                
                if (currentInputAudio) {
                    // Mix the main audio (from [a_base] or [a_main_vol]) with the BGM
                    const nextAudioOutput = '[a_mixed]';
                    complexFilters.push({ filter: 'amix', options: { inputs: 2, duration: 'shortest' }, inputs: [currentInputAudio, bgmVolumeOutput], outputs: nextAudioOutput });
                    currentInputAudio = nextAudioOutput; 
                } else {
                    // If no original audio existed, the BGM becomes the main source
                    currentInputAudio = bgmVolumeOutput;
                }
            }

            // --- FINAL MAPPING STAGE ---

            // Apply all filters defined in the array
            command.complexFilter(complexFilters); 

            // Map the final video stream label
            command.outputOptions(['-map ' + currentInputVideo]); 

            if (currentInputAudio) {
                // Map the final audio stream label (this is always a filter label now)
                command.outputOptions(['-map ' + currentInputAudio]);

                // Since we are using a complex filter graph, we MUST re-encode the audio
                command.outputOptions(['-c:a aac', '-b:a 192k']);
            } else {
                command.outputOptions(['-an']); 
            }

            if (hasBackgroundMusic) {
                command.outputOptions(['-shortest']);
            }


        // --- Execute Command ---
        command.on('start', (commandLine) => console.log('Spawned ffmpeg with command: ' + commandLine));
        command.save(outputVideo)
          .on('error', (err) => {
            console.error('An error occurred: ' + err.message);
            if (fs.existsSync(tempSubtitleFile)) fs.unlinkSync(tempSubtitleFile);
          })
          .on('end', () => {
            console.log('Processing finished successfully! Check ' + outputVideo);
            if (fs.existsSync(tempSubtitleFile)) fs.unlinkSync(tempSubtitleFile);
          });
    });
}


// --- Example Usage: Video will be exactly 600x300 ---
processVideo({
    inputVideo: 'lesson8.mp4',
    outputVideo: 'output_resized_600x300_fixed.mp4',
    backgroundMusic: 'background_music.mp3',
    subtitleFile: 'temp_subs.ass',
    // logoImage: 'images.jpeg',
    
    // Target output dimensions are 600x300
    videoWidth: 500, 
    videoHeight: 500,

    subtitlesData: [
        { start: 1, end: 4, text: "The video is now 600x300 resolution." },
        { start: 5, end: 8, text: "The font size is correct for this size." }
    ],
    // boxOptions: { x: 10, y: 10, w: 100, h: 50, color: 'purple@0.7', t: 'fill' },
});
