/** Right-hand preview of the dummy processed image for the selected file. */
export default function ResultViewer({ image, result }) {
  if (!image) {
    return (
      <div className="result-viewer empty">
        <p>Select an image from the table to view a result preview.</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="result-viewer empty">
        <p>Waiting for a dummy result for {image.name}…</p>
      </div>
    );
  }

  return (
    <div className="result-viewer">
      <div className="result-meta">
        <h2>{image.name}</h2>
        <p>
          Offset ({result.offsetX}, {result.offsetY}) px · rotation {result.rotationDeg}° · RMSE{" "}
          {result.rmse} px
        </p>
      </div>
      <div className="result-frame">
        <img src={result.previewUrl} alt={`Dummy processed result for ${image.name}`} />
      </div>
    </div>
  );
}
