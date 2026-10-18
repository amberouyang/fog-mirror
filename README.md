# Fog Mirror <img src="docs/heart.svg" alt="" height="26" />

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![MediaPipe](https://img.shields.io/badge/MediaPipe-0097A7?style=flat-square&logo=google&logoColor=white)

An interactive web app that turns your webcam into a fogged-up mirror. Draw through the fog with your fingers, wipe it away with your fist, and blow to fog it back up.

![Fog Mirror landing page](docs/landing.png)

## Try it

No download or setup needed.

1. Open **[amberouyang.github.io/fog-mirror](https://amberouyang.github.io/fog-mirror/)** in Chrome or Edge on a computer.
2. Click **Start**.
3. When your browser asks, click **Allow** for the camera and microphone.

## How to play

| Do this | To do this |
| --- | --- |
| Pinch your thumb and index finger together | Draw through the fog |
| Let go of the pinch | Stop drawing |
| Make a fist and move it around | Wipe the fog away |
| Make an "o" with your lips and blow | Fog the mirror back up |

- Use the **Brush** slider at the bottom to make your lines thicker or thinner.
- Click the **camera button** in the top-right corner to save a photo.
- Two people can play at the same time.

**Tips:** Stand about an arm's length from the camera in a bright room. When blowing, blow one long, steady breath toward your computer.

## Troubleshooting

- **The camera doesn't turn on:** click the camera icon in your browser's address bar, choose **Allow**, and reload the page.
- **Blowing doesn't work:** make sure the microphone is allowed too, and blow a little closer to your computer.
- **Your hands aren't detected:** turn on more light and keep your whole hand in view.

## Privacy

Everything runs in your browser. Your camera and microphone are never recorded or uploaded.

## For developers

To run Fog Mirror on your own computer:

```bash
git clone https://github.com/amberouyang/fog-mirror.git
cd fog-mirror
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Browsers only allow camera access on `localhost` or over HTTPS, so use a local server instead of opening `index.html` directly.

**How it works:** The mirrored camera image is blurred and tinted each frame, and a density mask controls where fog appears. [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) detects pinches and fists, and [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) with the Web Audio API detects blowing.

## Author

Amber Ouyang ([@amberouyang](https://github.com/amberouyang))
