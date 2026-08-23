import { useEffect, useMemo, useState } from "react";
import FilePicker from "./components/FilePicker.jsx";
import ImageTable from "./components/ImageTable.jsx";
import LogPanel from "./components/LogPanel.jsx";
import ResultViewer from "./components/ResultViewer.jsx";
import { createDummyResult, formatTimestamp, isImageFile } from "./dummyData.js";
import { isSupabaseConfigured } from "./supabaseClient.js";
import { listSourceImages, uploadSourceImage } from "./supabaseImages.js";

let nextLogId = 1;

function createImageRecord(file) {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    path: file.webkitRelativePath || file.name,
    size: file.size,
    status: isSupabaseConfigured ? "uploading" : "processed",
    file,
  };
}

// convert the database row to a record in javascript
function recordFromDatabaseRow(row) {
  return {
    id: row.id,
    name: row.name,
    path: row.relative_path || row.name,
    size: row.size_bytes,
    status: "stored",
  };
}

export default function App() {
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [resultsById, setResultsById] = useState({});
  const [logEntries, setLogEntries] = useState([]);
  const [busy, setBusy] = useState(false);

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

  function attachDummyResult(record) {
    const result = createDummyResult(record.name);
    setResultsById((prev) => ({ ...prev, [record.id]: result }));
    return result;
  }

  function updateImage(id, patch) {
    setImages((prev) => prev.map((image) => (image.id === id ? { ...image, ...patch } : image)));
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      appendLogs(
        ["Supabase is not configured. Copy frontend/.env.example to frontend/.env and add your project URL and anon key."],
        "warn"
      );
      return;
    }

    let cancelled = false;

    async function loadStoredImages() {
      try {
        const rows = await listSourceImages();
        if (cancelled) return;

        const records = rows.map(recordFromDatabaseRow);
        const dummyResults = {};
        records.forEach((record) => {
          dummyResults[record.id] = createDummyResult(record.name);
        });

        setImages(records);
        setResultsById(dummyResults);
        setSelectedId(records[0]?.id ?? null);
        appendLogs([`Connected to Supabase. Loaded ${records.length} stored image(s).`]);
      } catch (error) {
        if (!cancelled) {
          appendLogs([`Failed to load images from Supabase: ${error.message}`], "warn");
        }
      }
    }

    loadStoredImages();
    return () => {
      cancelled = true;
    };
    // Run once on startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  

  async function handleFilesSelected(files) {
    const imageFiles = files.filter(isImageFile);

    if (imageFiles.length === 0) {
      appendLogs(["No image files found in that selection."], "warn");
      return;
    }

    const records = imageFiles.map(createImageRecord);
    setImages((prev) => [...records, ...prev]);
    setSelectedId((prev) => prev ?? records[0].id);
    appendLogs([`Selected ${records.length} image file(s).`]);

    setBusy(true);
    try {
      for (const record of records) {
        try {
          if (isSupabaseConfigured) {
            await uploadSourceImage(record.file, record.id);
            updateImage(record.id, { status: "stored", file: undefined });
            appendLogs([`Stored ${record.name} in Supabase Storage.`]);
          }

          const result = attachDummyResult(record);
          updateImage(record.id, { status: "processed" });
          appendLogs(result.report);
        } catch (error) {
          updateImage(record.id, { status: "error", file: undefined });
          appendLogs([`Failed to store ${record.name}: ${error.message}`], "warn");
        }
      }
    } finally {
      setBusy(false);
    }
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
          <p className="subtitle">Select images to store in Supabase, then review dummy process reports.</p>
        </div>
        <div className="header-actions">
          <FilePicker onFilesSelected={handleFilesSelected} disabled={busy} />
          <button type="button" className="btn btn-ghost" onClick={handleClear} disabled={images.length === 0 || busy}>
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
