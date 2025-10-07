import React, { useState, useEffect } from 'react';

const DocStructureEditor = () => {
  const [docsStructure, setDocsStructure] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [newFileName, setNewFileName] = useState('');

  useEffect(() => {
    const fetchDocs = async () => {
      const structureResponse = await fetch('/api/docs/structure');
      const metadataResponse = await fetch('/api/docs/metadata');
      const structureData = await structureResponse.json();
      const metadataData = await metadataResponse.json();
      
      setDocsStructure(structureData.structure);
      setMetadata(metadataData.metadata);
    };

    fetchDocs();
  }, []);

  // Function to rename a file
  const renameFile = async (oldName, newName) => {
    const response = await fetch('/api/editor/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_name: oldName, new_name: newName }),
    });

    const data = await response.json();
    alert(data.message);
    // Refetch the structure
    setDocsStructure((prev) =>
      prev.map((file) => (file === oldName ? newName : file))
    );  
  };

  // Function to update metadata
  const updateMetadata = async (file, newMetadata) => {
    const response = await fetch('/api/docs/metadata/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: file, new_metadata: newMetadata }),
    });

    const data = await response.json();
    alert(data.message);
    // Refetch metadata
    setMetadata((prev) => ({
      ...prev,
      [file]: newMetadata,
    }));
  };

  return (
    <div>
      <h1>Documentation Structure Editor</h1>

      <ul>
        {docsStructure.map((file) => (
          <li key={file}>
            <div>{file} 
              <button onClick={() => renameFile(file, prompt('Enter new name:'))}>Rename</button>
              <button onClick={() => updateMetadata(file, { published: true })}>Mark as Published</button>
            </div>
          </li>
        ))}
      </ul>

      <div>
        <input
          type="text"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          placeholder="New file name"
        />
        <button>Create File</button>
      </div>
    </div>
  );
};

export default DocStructureEditor;
