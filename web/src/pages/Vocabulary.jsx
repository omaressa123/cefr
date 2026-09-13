import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../api/client.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
export default function Vocabulary() {
  const [level, setLevel] = useState(""); const [search, setSearch] = useState(""); const [items, setItems] = useState([]); const [error, setError] = useState(null);
  async function load() { try { setError(null); const params = {}; if (level) params.level = level; if (search.trim()) params.search = search.trim(); const data = await api.listVocabulary(params); setItems(data.items); } catch (err) { setError(err.message); } }
  useEffect(() => { load(); }, [level]);
  return <Layout><div className="eyebrow">Vocabulary</div><h1>Words you can use.</h1><div className="toolbar"><select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">All levels</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search words or definitions" /><button onClick={load}>Search</button></div>{error && <div className="error-banner">{error}</div>}<div className="content-list">{items.map((item) => <Link to={`/learning/vocabulary/${item.id}`} className="panel content-row" key={item.id}><div><span className="pill accent">{item.cefr_level}</span><h3>{item.word}</h3><p>{item.definition}</p></div><div className="row-meta"><span>{item.category?.name}</span><span>{item.progress_status === "learned" ? "Learned" : "Learn"}</span></div></Link>)}</div>{!items.length && <div className="empty-state">No vocabulary matches this search.</div>}</Layout>;
}