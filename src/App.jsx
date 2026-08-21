import { useMemo, useState } from "react";
import FilePicker from "./components/FilePicker.jsx";
import ImageTable from "./components/ImageTable.jsx";
import LogPanel from "./components/LogPanel.jsx";
import ResultViewer from "./components/ResultViewer.jsx";
import { createDummyResult, formatTimestamp, isImageFile } from "./dummyData.js";

let nextImageId = 1;
let nextLogId = 1;

function createImageRecord(file) {
  return {
    id: `img-${nextImageId++}`,
    name: file.name,
    path: file.webkitRelativePath || file.name,
    size: file.size,
    status: "processed",
  };
}

export default function App() {
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [resultsById, setResultsById] = useState({});
  const [logEntries, setLogEntries] = useState([]);

  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedId) ?? null,
    [images, selectedId]
  );
  const selectedResult = selectedId ? resultsById[selectedId] ?? null : null;

  function appendLogs(messages, level = "info") {
    const time = formatTimestamp();
    const entries = messages.map((message) => ({
      id: `log-${nextLogId++}`,
      time,
      level,
      message,
    }));
    setLogEntries((prev) => [...prev, ...entries]);
  }

  // No backend yet: keep file names only and attach dummy reports/previews.
  function handleFilesSelected(files) {
    const imageFiles = files.filter(isImageFile);

    if (imageFiles.length === 0) {
      appendLogs(["No image files found in that selection."], "warn");
      return;
    }

    const records = imageFiles.map(createImageRecord);
    const dummyResults = {};
    const messages = [`Loaded ${records.length} image file(s).`];

    records.forEach((record) => {
      const result = createDummyResult(record.name);
      dummyResults[record.id] = result;
      messages.push(...result.report);
    });

    setImages((prev) => [...prev, ...records]);
    setResultsById((prev) => ({ ...prev, ...dummyResults }));
    setSelectedId((prev) => prev ?? records[0].id);
    appendLogs(messages);
  }

  function handleClear() {
    setImages([]);
    setSelectedId(null);
    setResultsById({});
    setLogEntries([]);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>USAF Registration</h1>
          <p className="subtitle">Select images, then review dummy process reports and result previews.</p>
        </div>
        <div className="header-actions">
          <FilePicker onFilesSelected={handleFilesSelected} />
          <button type="button" className="btn btn-ghost" onClick={handleClear} disabled={images.length === 0}>
            Clear
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="panel">
            <h2>Images</h2>
            <ImageTable images={images} selectedId={selectedId} onSelect={setSelectedId} />
          </section>
          <section className="panel log-section">
            <h2>Process log</h2>
            <LogPanel entries={logEntries} />
          </section>
        </aside>

        <section className="panel result-section">
          <h2>Result</h2>
          <ResultViewer image={selectedImage} result={selectedResult} />
        </section>
      </main>
    </div>
  );
}
