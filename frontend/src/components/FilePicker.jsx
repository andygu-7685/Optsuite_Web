import { useRef } from "react";

/**
 * Hidden file inputs plus two buttons: pick a single image, or a whole folder.
 * Folder picking uses the non-standard webkitdirectory attribute (Chrome/Edge).
 */
export default function FilePicker({ onFilesSelected, disabled }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  function handleChange(event) {
    const files = Array.from(event.target.files || []);
    onFilesSelected(files);
    // Allow selecting the same path again later.
    event.target.value = "";
  }

  return (
    <div className="file-picker">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        webkitdirectory=""
        directory=""
        hidden
        onChange={handleChange}
      />

      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        Pick image
      </button>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => folderInputRef.current?.click()}
      >
        Pick folder
      </button>
    </div>
  );
}
