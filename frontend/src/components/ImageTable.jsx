function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Sidebar table of selected image names. Click a row to show its dummy result. */
export default function ImageTable({ images, selectedId, onSelect }) {
  if (images.length === 0) {
    return (
      <div className="empty-state">
        No stored images yet. Use Pick image or Pick folder to upload files.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="image-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {images.map((image) => {
            const selected = image.id === selectedId;
            return (
              <tr
                key={image.id}
                className={selected ? "is-selected" : undefined}
                onClick={() => onSelect(image.id)}
              >
                <td title={image.path}>{image.name}</td>
                <td>{formatBytes(image.size)}</td>
                <td>
                  <span className={`status status-${image.status}`}>{image.status}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
