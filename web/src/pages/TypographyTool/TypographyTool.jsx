import React, { useState } from "react";
import "./TypographyTool.css";

const FONT_OPTIONS = [
  { value: "Anton", label: "Anton" },
  { value: "Bebas Neue", label: "Bebas Neue" },
  { value: "Oswald", label: "Oswald" },
  { value: "Playfair Display", label: "Playfair Display" },
  { value: "Inter", label: "Inter" },
  { value: "Libre Baskerville", label: "Libre Baskerville" },
];

const COLOR_OPTIONS = [
  "#F7F8FC", "#7C5CFC", "#4F8CFF", "#B7A7FF",
  "#36C98F", "#F4B860", "#F06C7A", "#5EA7FF",
  "#C85A32", "#B59A5F", "#F5F5F0", "#1A2438",
];

const STROKE_OPTIONS = ["0px", "1px", "2px", "3px", "4px", "5px"];
const SHADOW_OPTIONS = ["0px", "1px", "2px", "3px", "4px", "5px", "6px", "8px"];
const SPACING_OPTIONS = ["0px", "1px", "2px", "3px", "4px", "5px", "6px", "8px", "10px"];

export default function TypographyTool() {
  const [text, setText] = useState("CEFR PRACTICE");
  const [fontFamily, setFontFamily] = useState("Anton");
  const [fontSize, setFontSize] = useState(120);
  const [fontWeight, setFontWeight] = useState("700");
  const [letterSpacing, setLetterSpacing] = useState("0px");
  const [textColor, setTextColor] = useState("#F7F8FC");
  const [effect, setEffect] = useState("outline");
  const [strokeColor, setStrokeColor] = useState("#1A2438");
  const [strokeWidth, setStrokeWidth] = useState("2px");
  const [shadowColor, setShadowColor] = useState("#0B1020");
  const [shadowX, setShadowX] = useState("4px");
  const [shadowY, setShadowY] = useState("4px");
  const [shadowBlur, setShadowBlur] = useState("0px");
  const [shadowSpread, setShadowSpread] = useState("0px");
  const [textShadowLayers, setTextShadowLayers] = useState(2);
  const [gradientFrom, setGradientFrom] = useState("#7C5CFC");
  const [gradientTo, setGradientTo] = useState("#4F8CFF");
  const [rotation, setRotation] = useState(0);
  const [animationType, setAnimationType] = useState("none");
  const [animationDuration, setAnimationDuration] = useState(2);
  const [bgColor, setBgColor] = useState("#0B1020");
  const [clipShape, setClipShape] = useState("none");
  const [opacity, setOpacity] = useState(1);

  function getShadowStyle() {
    const layers = [];
    for (let i = 1; i <= textShadowLayers; i++) {
      const spread = parseInt(shadowSpread) + (i - 1) * 2;
      layers.push(
        `${shadowX} ${shadowY} ${shadowBlur} ${spread}px ${shadowColor}`
      );
    }
    return layers.join(", ");
  }

  function getGradientStyle() {
    return `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`;
  }

  function getEffectClass() {
    const map = {
      outline: "effect-outline",
      gradient: "effect-gradient",
      "3d": "effect-3d",
      shadow: "effect-shadow",
      kinetic: "effect-kinetic",
      clip: "effect-clip",
      none: "effect-none",
      glow: "effect-glow",
      gradient3d: "effect-gradient3d",
      dashed: "effect-dashed",
    };
    return map[effect] || "effect-none";
  }

  function getAnimationClass() {
    if (animationType === "none") return "";
    return `anim-${animationType}`;
  }

  const displayStyle = {
    fontFamily: `'${fontFamily}', sans-serif`,
    fontSize: `${fontSize}px`,
    fontWeight,
    letterSpacing: `${letterSpacing}`,
    color: textColor,
    background: effect === "gradient" || effect === "gradient3d" ? getGradientStyle() : undefined,
    boxShadow: effect === "shadow" ? getShadowStyle() : undefined,
    textShadow: effect !== "shadow" ? getShadowStyle() : undefined,
    transform: `rotate(${rotation}deg)`,
    opacity,
    clipPath: clipShape === "none" ? undefined : clipShape === "circle" ? "circle(50%)" :
              clipShape === "ellipse" ? "ellipse(50% 50%)" :
              clipShape === "triangle" ? "polygon(50% 0%, 0% 100%, 100% 100%)" :
              clipShape === "diamond" ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" :
              clipShape === "hexagon" ? "polygon(50% 0%, 90% 25%, 90% 75%, 50% 100%, 10% 75%, 10% 25%)" :
              undefined,
    "-webkit-background-clip": effect === "gradient" || effect === "gradient3d" ? "text" : undefined,
    "-webkit-text-fill-color": effect === "gradient" || effect === "gradient3d" ? "transparent" : undefined,
    animationDuration: `${animationDuration}s`,
  };

  return (
    <div className="typo-page" style={{ "--bg-color": bgColor }}>
      <div className="typo-container">
        <header className="typo-header">
          <h1 className="typo-page-title">Typography Studio</h1>
          <p className="typo-page-subtitle">Shape · Font · Visual Effects</p>
        </header>

        <div className="typo-layout">
          <div className="typo-preview-panel">
            <div className="typo-preview-area" style={{ backgroundColor: bgColor }}>
              <div className="typo-text-wrapper">
                <div className={`typo-display-text ${getEffectClass()} ${getAnimationClass()}`} style={displayStyle}>
                  {text}
                </div>
              </div>
            </div>
          </div>

          <div className="typo-controls-panel">
            <div className="typo-control-section">
              <h3 className="typo-section-title">Text</h3>
              <label className="typo-label">Content</label>
              <input
                type="text"
                className="typo-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter text..."
              />
            </div>

            <div className="typo-control-section">
              <h3 className="typo-section-title">Font</h3>
              <label className="typo-label">Font Family</label>
              <select className="typo-select" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <label className="typo-label">Weight</label>
              <select className="typo-select" value={fontWeight} onChange={(e) => setFontWeight(e.target.value)}>
                <option value="300">Light 300</option>
                <option value="400">Regular 400</option>
                <option value="500">Medium 500</option>
                <option value="600">SemiBold 600</option>
                <option value="700">Bold 700</option>
                <option value="800">ExtraBold 800</option>
                <option value="900">Black 900</option>
              </select>
              <label className="typo-label">Size: {fontSize}px</label>
              <input type="range" className="typo-range" min="20" max="300" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
              <label className="typo-label">Letter Spacing</label>
              <input type="range" className="typo-range" min="-5" max="30" value={parseInt(letterSpacing)} onChange={(e) => setLetterSpacing(`${e.target.value}px`)} />
            </div>

            <div className="typo-control-section">
              <h3 className="typo-section-title">Colors</h3>
              <label className="typo-label">Background</label>
              <input type="color" className="typo-color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
              <label className="typo-label">Text Color</label>
              <input type="color" className="typo-color" value={textColor} onChange={(e) => setTextColor(e.target.value)} />
              <div className="typo-color-grid">
                {COLOR_OPTIONS.map(c => (
                  <button key={c} className={`typo-color-swatch ${textColor === c ? "active" : ""}`} style={{ backgroundColor: c }} onClick={() => setTextColor(c)} />
                ))}
              </div>
            </div>

            <div className="typo-control-section">
              <h3 className="typo-section-title">Effect</h3>
              <label className="typo-label">Type</label>
              <select className="typo-select" value={effect} onChange={(e) => setEffect(e.target.value)}>
                <option value="none">None</option>
                <option value="outline">Outline / Stroke</option>
                <option value="gradient">Gradient Fill</option>
                <option value="3d">3D Shadow</option>
                <option value="shadow">Drop Shadow</option>
                <option value="glow">Neon Glow</option>
                <option value="gradient3d">Gradient + 3D</option>
                <option value="dashed">Dashed Outline</option>
                <option value="kinetic">Kinetic</option>
                <option value="clip">Shape Clip</option>
              </select>
            </div>

            {effect === "outline" && (
              <div className="typo-control-section">
                <h3 className="typo-section-title">Outline</h3>
                <label className="typo-label">Stroke Color</label>
                <input type="color" className="typo-color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
                <label className="typo-label">Stroke Width</label>
                <select className="typo-select" value={strokeWidth} onChange={(e) => setStrokeWidth(e.target.value)}>
                  {STROKE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {effect === "gradient" && (
              <div className="typo-control-section">
                <h3 className="typo-section-title">Gradient</h3>
                <label className="typo-label">From</label>
                <input type="color" className="typo-color" value={gradientFrom} onChange={(e) => setGradientFrom(e.target.value)} />
                <label className="typo-label">To</label>
                <input type="color" className="typo-color" value={gradientTo} onChange={(e) => setGradientTo(e.target.value)} />
              </div>
            )}

            {(effect === "3d" || effect === "shadow" || effect === "none") && (
              <div className="typo-control-section">
                <h3 className="typo-section-title">Shadow</h3>
                <label className="typo-label">Color</label>
                <input type="color" className="typo-color" value={shadowColor} onChange={(e) => setShadowColor(e.target.value)} />
                <label className="typo-label">Layers</label>
                <select className="typo-select" value={textShadowLayers} onChange={(e) => setTextShadowLayers(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <label className="typo-label">X: {shadowX}</label>
                <input type="range" className="typo-range" min="-20" max="20" value={parseInt(shadowX)} onChange={(e) => setShadowX(`${e.target.value}px`)} />
                <label className="typo-label">Y: {shadowY}</label>
                <input type="range" className="typo-range" min="-20" max="20" value={parseInt(shadowY)} onChange={(e) => setShadowY(`${e.target.value}px`)} />
                <label className="typo-label">Blur: {shadowBlur}</label>
                <input type="range" className="typo-range" min="0" max="30" value={parseInt(shadowBlur)} onChange={(e) => setShadowBlur(`${e.target.value}px`)} />
                <label className="typo-label">Spread: {shadowSpread}</label>
                <input type="range" className="typo-range" min="-5" max="20" value={parseInt(shadowSpread)} onChange={(e) => setShadowSpread(`${e.target.value}px`)} />
              </div>
            )}

            {effect === "clip" && (
              <div className="typo-control-section">
                <h3 className="typo-section-title">Clip Shape</h3>
                <select className="typo-select" value={clipShape} onChange={(e) => setClipShape(e.target.value)}>
                  <option value="none">None</option>
                  <option value="circle">Circle</option>
                  <option value="ellipse">Ellipse</option>
                  <option value="triangle">Triangle</option>
                  <option value="diamond">Diamond</option>
                  <option value="hexagon">Hexagon</option>
                </select>
              </div>
            )}

            <div className="typo-control-section">
              <h3 className="typo-section-title">Motion</h3>
              <label className="typo-label">Animation</label>
              <select className="typo-select" value={animationType} onChange={(e) => setAnimationType(e.target.value)}>
                <option value="none">None</option>
                <option value="slide">Slide In</option>
                <option value="pulse">Pulse</option>
                <option value="glow">Glow Pulse</option>
                <option value="shake">Shake</option>
                <option value="float">Float</option>
                <option value="typewriter">Typewriter</option>
                <option value="gradient-flow">Gradient Flow</option>
                <option value="wave">Wave</option>
              </select>
              <label className="typo-label">Duration: {animationDuration}s</label>
              <input type="range" className="typo-range" min="0.5" max="10" step="0.5" value={animationDuration} onChange={(e) => setAnimationDuration(Number(e.target.value))} />
            </div>

            <div className="typo-control-section">
              <h3 className="typo-section-title">Transform</h3>
              <label className="typo-label">Rotation: {rotation}deg</label>
              <input type="range" className="typo-range" min="-180" max="180" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
              <label className="typo-label">Opacity</label>
              <input type="range" className="typo-range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </div>

            <div className="typo-code-section">
              <h3 className="typo-section-title">Generated CSS</h3>
              <pre className="typo-code">{`/* ${effect.toUpperCase()} EFFECT */
.typo-display-text {
  font-family: '${fontFamily}';
  font-size: ${fontSize}px;
  font-weight: ${fontWeight};
  letter-spacing: ${letterSpacing};
  color: ${textColor};
  ${effect === "outline" ? `color: transparent;\n  -webkit-text-stroke: ${strokeWidth} ${strokeColor};\n  text-stroke: ${strokeWidth} ${strokeColor};` : ""}
  ${effect === "gradient" ? `background: ${getGradientStyle()};\n  -webkit-background-clip: text;\n  -webkit-text-fill-color: transparent;\n  background-clip: text;` : ""}
  ${(effect === "3d" || effect === "shadow") ? `text-shadow: ${getShadowStyle()};` : ""}
  ${effect === "glow" ? `text-shadow: 0 0 10px ${textColor}, 0 0 20px ${textColor}, 0 0 40px ${textColor};` : ""}
  ${effect === "dashed" ? `color: ${textColor};\n  -webkit-text-stroke: ${strokeWidth} ${strokeColor};\n  text-stroke: ${strokeWidth} ${strokeColor};\n  letter-spacing: ${parseInt(letterSpacing) + 10}px;` : ""}
  ${effect === "clip" ? `clip-path: ${clipShape === "circle" ? "circle(50%)" : clipShape === "ellipse" ? "ellipse(50% 50%)" : clipShape === "triangle" ? "polygon(50% 0%, 0% 100%, 100% 100%)" : clipShape === "diamond" ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : "polygon(50% 0%, 90% 25%, 90% 75%, 50% 100%, 10% 75%, 10% 25%)"};` : ""}
  transform: rotate(${rotation}deg);
  opacity: ${opacity};
}`}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}