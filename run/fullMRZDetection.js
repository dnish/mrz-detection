'use strict';

var IJS = require('image-js').Image;
var fs = require('fs');
var tableify = require('tableify');
var loadFingerprints = require('../src/util/loadAllFontData');
var runFontAnalysis = require('../src/runFontAnalysis');

var {
    isMRZCorrect,
    getMRZ,
    filterManager,
    getLetterStats,
    codes,
    fingerprintOptions,
    roiOptions
} = require('../src/MRZDetection');

// options
const maskOptions = {
    invert: true,
    algorithm: 'isodata'
};

const allFingerprints = {
    height: fingerprintOptions.height,
    width: fingerprintOptions.width,
    category: fingerprintOptions.category,
    maxSimilarity: 0.7, // we store all the different fontFingerprint
    fontName: ''
};

module.exports = function (paths) {
    var {readPath, saveHTMLFile, saveMask, saveMRZ} = paths;

    var allFontFingerprints = loadFingerprints(allFingerprints);

    var files = fs.readdirSync(readPath);
    files = files.filter(
        (files) => files.endsWith('.png') || files.endsWith('.jpg')
    );
    console.log(files);
    var promises = files.map((elem) => IJS.load(readPath + elem));
    var table = [];

    return Promise.all(promises).then(function (images) {
        var counters = new Array(Object.keys(codes).length).fill(0);

        for (var i = 0; i < images.length; i++) {
            console.log('processing:', files[i]);
            var image = images[i];
            var grey = image.grey({allowGrey: true});
            var mask = grey.mask(maskOptions);

            if (!fs.existsSync(saveMask)) {
                fs.mkdirSync(saveMask);
            }

            var maskPath =
                saveMask +
                files[i].replace('.png', '.bmp').replace('.jpg', '.bmp');
            mask.save(maskPath, {
                useCanvas: false,
                format: 'bmp'
            });
            var manager = image.getRoiManager();
            manager.fromMask(mask);

            var {parseRowInfo, rowsInfo, rois} = filterManager(manager);

            try {
                var {
                    y,
                    height,
                    filteredHistogram,
                    simPeaks,
                    simBetweenPeaks
                } = getMRZ(parseRowInfo, rowsInfo, rois, image.width);
            } catch (e) {
                console.log('not able to find mrz for', files[i]);
                continue;
            }

            var margin = 10;

            var crop = image.crop({
                y: y - margin,
                height: height + 2 * margin
            });

            var results = runFontAnalysis(crop, allFontFingerprints, {
                fingerprintOptions: allFingerprints,
                roiOptions
            }).slice(0, 5);

            console.log(`for file ${files[i]}:`);
            for (var result of results) {
                console.log(
                    '----------',
                    result.fontName,
                    '--',
                    'Total similarity: ',
                    result.totalSimilarity / result.totalFound,
                    '-',
                    'Total found: ',
                    result.totalFound,
                    '-',
                    'Total not found: ',
                    result.totalNotFound
                );
            }

            if (!fs.existsSync(saveMRZ)) {
                fs.mkdirSync(saveMRZ);
            }
            var cropPath = saveMRZ + files[i];
            crop.save(cropPath, {
                useCanvas: false,
                format: 'png'
            });

            // get letter mrz
            var {code, outputTable} = isMRZCorrect(crop, files[i]);
            counters[code]++;

            if (code === codes.PREPROCESS_ERROR.code) {
                console.log('preprocess error');
                continue;
            }

            if (code === codes.CORRECT.code) {
                console.log(`file: ${files[i]} is correct!`);
            }

            table.push({
                image: [
                    `<img src="./${maskPath}" width="600" height="600">`,
                    `<img src="./${cropPath}" width="600" height="200">`
                ].concat(outputTable.images),
                filename: files[i],
                'Row info median': `<span class='histogram'>${parseRowInfo.join(
                    ','
                )}</span>`,
                'Filtered info median': `<span class='histogram'>${filteredHistogram.join(
                    ','
                )}</span>`,
                simPeaks: simPeaks,
                simBetweenPeaks: simBetweenPeaks,
                'Error information': outputTable['Error Information'],
                'Code error': outputTable['Code Error'],
                Histogram: outputTable.Histogram
                // 'Col info median': `<span class='histogram'>${colsInfo.join(',')}</span>`
            });
        }

        console.log(getLetterStats());

        fs.writeFileSync(
            saveHTMLFile,
            `
                <!DOCTYPE html>
                <html>
                <head>
                <style>
                    html *
                    {
                        font-family: "Courier New", Courier, monospace;
                    }
                </style>
                </head>
                <body>
                ${tableify(table)}
                </body>
                <script src="https://code.jquery.com/jquery-3.2.1.js"
                integrity="sha256-DZAnKJ/6XZ9si04Hgrsxu/8s717jcIzLy3oi35EouyE="
                crossorigin="anonymous"></script>
                <script src="https://omnipotent.net/jquery.sparkline/2.1.2/jquery.sparkline.js"></script>
                <script type="text/javascript">
                $(function() {
                    /** This code runs when everything has been loaded on the page */
                    /* Inline sparklines take their values from the contents of the tag */
                    $('.histogram').sparkline('html', {
                        type: 'line',
                        width: 400,
                        height: 100
                    }); 
                });
                </script>
                </html>
            `
        );

        return {
            stats: getLetterStats()
        };
    });
};
