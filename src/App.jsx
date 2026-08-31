import React, { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import {
  Search, Plus, Pencil, Trash2, X, MapPin, Printer,
  ClipboardList, Waves, Mountain, Activity, Globe,
  Building2, Calendar, User, Check, AlertCircle, Clock, RotateCcw, Package,
  Upload, Download, FileSpreadsheet, AlertTriangle, Cloud, ShieldCheck
} from "lucide-react";
import {
  subscribeSetores,
  subscribeMateriais,
  subscribeEmprestimos,
  addSetor,
  saveMaterial,
  deleteMaterial,
  createEmprestimo,
  updateFormalizacao,
  registrarDevolucao,
  importarMateriaisFirestore
} from "./firebase";

const ICONES_SETOR_PADRAO = {
  Hidrografia: Waves,
  Topografia: Mountain,
  Maregrafia: Activity,
  Geodésia: Globe,
};
const iconePara = (nome) => ICONES_SETOR_PADRAO[nome] || Package;

const STATUS_META = {
  Disponível: { color: "#1F6F64", bg: "#E4F0EC" },
  Emprestado: { color: "#A6472F", bg: "#F5E7E2" },
  Manutenção: { color: "#6B6458", bg: "#EEECE5" },
};

const ESTADO_META = {
  Excelente: { color: "#1F6F64", bg: "#E4F0EC" },
  Bom: { color: "#2C5F7C", bg: "#E5EEF2" },
  Ruim: { color: "#A6472F", bg: "#F5E7E2" },
  "Aguardando LVAD": { color: "#8B6B2E", bg: "#F2ECDE" },
};

const EMPTY_FORM = {
  nome: "",
  patrimonio: "",
  setor: "Hidrografia",
  localizacao: "",
  status: "Disponível",
  estado: "Excelente",
  descricao: ""
};

const EMPTY_EMPRESTIMO_FORM = {
  orgao: "",
  solicitante: "",
  prazo: "",
  dataFormalizacao: "",
  observacoes: ""
};

// --- Leitura de planilha/CSV ---
const ALIASES_COLUNA = {
  nome: ["nome", "material", "item", "equipamento"],
  patrimonio: ["patrimonio", "numeropatrimonial", "npatrimonial", "tombamento", "numtombamento", "numeropatrimonio"],
  setor: ["setor", "grupo", "categoria"],
  localizacao: ["localizacao", "prateleira", "local", "posicao"],
  estado: ["estado", "condicao", "estadoconservacao", "conservacao"],
  status: ["status", "disponibilidade", "situacao"],
  descricao: ["descricao", "obs", "observacao", "observacoes", "detalhes"],
};

function normalizarChave(k) {
  return (k || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function mapearLinhaCSV(row) {
  const mapa = {};
  Object.entries(row).forEach(([k, v]) => {
    const chave = normalizarChave(k);
    for (const [campo, aliases] of Object.entries(ALIASES_COLUNA)) {
      if (aliases.includes(chave)) mapa[campo] = (v || "").toString().trim();
    }
  });
  return mapa;
}

function formatarDataHora(v) {
  if (!v) return null;
  const d = new Date(v);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatarData(v) {
  if (!v) return null;
  return new Date(v.length > 10 ? v : v + "T00:00").toLocaleDateString("pt-BR");
}

export default function App() {
  const [materiais, setMateriais] = useState([]);
  const [setoresList, setSetoresList] = useState([]);
  const [emprestimosList, setEmprestimosList] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [setoresAtivos, setSetoresAtivos] = useState(new Set());
  const [orgaoFiltro, setOrgaoFiltro] = useState(null);
  const [busca, setBusca] = useState("");
  const [cesta, setCesta] = useState([]);
  const [painelCesta, setPainelCesta] = useState(false);
  const [modalMaterial, setModalMaterial] = useState(null);
  const [modalImportar, setModalImportar] = useState(false);
  const [recibo, setRecibo] = useState(null);
  const [historicoAlvo, setHistoricoAlvo] = useState(null);
  const [formEmprestimo, setFormEmprestimo] = useState(EMPTY_EMPRESTIMO_FORM);
  const [enviandoEmprestimo, setEnviandoEmprestimo] = useState(false);
  const [erroEmprestimo, setErroEmprestimo] = useState("");

  // Inscrições em Tempo Real no Firebase Firestore
  useEffect(() => {
    let unsubs = [];
    setCarregando(true);

    const unsubSetores = subscribeSetores((setores) => {
      setSetoresList(setores);
    });

    const unsubMateriais = subscribeMateriais((mats) => {
      setMateriais(mats);
      setCarregando(false);
    });

    const unsubEmprestimos = subscribeEmprestimos((emps) => {
      setEmprestimosList(emps);
    });

    unsubs = [unsubSetores, unsubMateriais, unsubEmprestimos];

    return () => {
      unsubs.forEach((u) => u && typeof u === "function" && u());
    };
  }, []);

  const setoresConfig = useMemo(() => {
    const cfg = {};
    setoresList.forEach((s) => {
      cfg[s.nome] = { icon: iconePara(s.nome), color: s.cor || "#6B6458" };
    });
    return cfg;
  }, [setoresList]);

  const orgaosMap = useMemo(() => {
    const map = {};
    emprestimosList.forEach((e) => {
      const org = e.orgao;
      if (!org) return;
      if (!map[org]) {
        map[org] = { total: 0, abertos: 0 };
      }
      const qtd = (e.itens || []).length;
      map[org].total += qtd;
      if (e.status === "Em aberto") {
        map[org].abertos += qtd;
      }
    });
    return map;
  }, [emprestimosList]);

  const setores = Object.keys(setoresConfig);

  const contagemSetor = useMemo(() => {
    const c = {};
    setores.forEach((s) => (c[s] = 0));
    materiais.forEach((m) => (c[m.setor] = (c[m.setor] || 0) + 1));
    return c;
  }, [materiais, setores]);

  const filtrados = useMemo(() => {
    return materiais.filter((m) => {
      const passaSetor = setoresAtivos.size === 0 || setoresAtivos.has(m.setor);
      const passaBusca =
        busca.trim() === "" ||
        (m.nome || "").toLowerCase().includes(busca.toLowerCase()) ||
        (m.patrimonio || "").includes(busca);
      const passaOrgao = !orgaoFiltro || m.orgaoAtual === orgaoFiltro;
      return passaSetor && passaBusca && passaOrgao;
    });
  }, [materiais, setoresAtivos, busca, orgaoFiltro]);

  const toggleSetor = (s) => {
    setSetoresAtivos((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const toggleOrgaoFiltro = (org) => setOrgaoFiltro((prev) => (prev === org ? null : org));

  const handleAdicionarSetor = async (nomeBruto) => {
    const nome = nomeBruto.trim();
    if (!nome) return;
    try {
      await addSetor(nome);
    } catch (err) {
      alert("Erro ao adicionar setor: " + err.message);
    }
  };

  const addNaCesta = (material) => {
    if (material.status !== "Disponível") return;
    if (cesta.find((c) => c.id === material.id)) return;
    setCesta((prev) => [...prev, material]);
    setPainelCesta(true);
  };

  const removeDaCesta = (id) => setCesta((prev) => prev.filter((c) => c.id !== id));

  const confirmarEmprestimo = async () => {
    if (!formEmprestimo.orgao || !formEmprestimo.solicitante || cesta.length === 0) return;
    setEnviandoEmprestimo(true);
    setErroEmprestimo("");
    try {
      const criado = await createEmprestimo({
        orgao: formEmprestimo.orgao,
        solicitante: formEmprestimo.solicitante,
        itens: cesta,
        prazo: formEmprestimo.prazo,
        dataFormalizacao: formEmprestimo.dataFormalizacao,
        observacoes: formEmprestimo.observacoes
      });
      setRecibo({ ...criado, itens: criado.itensDetalhados });
      setCesta([]);
      setPainelCesta(false);
      setFormEmprestimo(EMPTY_EMPRESTIMO_FORM);
    } catch (err) {
      setErroEmprestimo(err.message || "Erro ao confirmar empréstimo.");
    } finally {
      setEnviandoEmprestimo(false);
    }
  };

  const handleAtualizarFormalizacao = async (emprestimoId, valor) => {
    try {
      await updateFormalizacao(emprestimoId, valor);
    } catch (err) {
      alert("Erro ao salvar formalização: " + err.message);
    }
  };

  const handleRegistrarDevolucao = async (emprestimo) => {
    try {
      await registrarDevolucao(emprestimo);
    } catch (err) {
      alert("Erro ao registrar devolução: " + err.message);
    }
  };

  const handleSalvarMaterial = async (dados) => {
    const isNovo = modalMaterial.mode === "novo";
    try {
      await saveMaterial(dados, isNovo);
      setModalMaterial(null);
    } catch (err) {
      alert(err.message || "Erro ao salvar material.");
    }
  };

  const handleExcluirMaterial = async (id) => {
    if (!window.confirm("Deseja realmente excluir este material do acervo?")) return;
    setCesta((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteMaterial(id);
    } catch (err) {
      alert("Erro ao excluir material: " + err.message);
    }
  };

  const handleImportarArquivo = async (linhasValidas) => {
    return await importarMateriaisFirestore(linhasValidas);
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#F5F4EF", minHeight: "100vh", color: "#13293D" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .sg { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .paper-bg {
          background-image:
            linear-gradient(#E4E1D5 1px, transparent 1px),
            linear-gradient(90deg, #E4E1D5 1px, transparent 1px);
          background-size: 24px 24px;
        }
        button { cursor: pointer; }
      `}</style>

      <header style={{ background: "#13293D", color: "#F5F4EF", padding: "16px 28px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, border: "2px solid #B8863B", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MapPin size={18} color="#B8863B" />
          </div>
          <div>
            <div className="sg" style={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.2 }}>Paiol Técnico</div>
            <div style={{ fontSize: 11.5, color: "#9FB2C2" }}>CHN-4 (Centro de Hidrografia e Navegação do Norte)</div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 220, display: "flex", alignItems: "center", background: "#1C3A50", borderRadius: 8, padding: "8px 12px", gap: 8 }}>
          <Search size={16} color="#9FB2C2" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou número patrimonial..."
            style={{ background: "transparent", border: "none", outline: "none", color: "#F5F4EF", fontSize: 13.5, width: "100%" }}
          />
        </div>

        {/* Status de conexão Firebase */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(31,111,100,0.25)", border: "1px solid #1F6F64", padding: "6px 12px", borderRadius: 6, fontSize: 11.5, color: "#A3E5D8" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2EE59D", display: "inline-block" }}></span>
          <span>Cloud Firestore (Tempo Real)</span>
        </div>

        <button
          onClick={() => setModalImportar(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1.5px solid #3E5A70", color: "#F5F4EF", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}
        >
          <Upload size={16} /> Importar planilha
        </button>

        <button
          onClick={() => setModalMaterial({ mode: "novo", data: EMPTY_FORM })}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#B8863B", color: "#13293D", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}
        >
          <Plus size={16} /> Novo material
        </button>

        <button
          onClick={() => setPainelCesta(true)}
          style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1.5px solid #3E5A70", color: "#F5F4EF", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}
        >
          <ClipboardList size={16} /> Empréstimo
          {cesta.length > 0 && (
            <span style={{ position: "absolute", top: -7, right: -7, background: "#A6472F", color: "#fff", borderRadius: 999, fontSize: 10.5, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {cesta.length}
            </span>
          )}
        </button>
      </header>

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <aside style={{ width: 240, flexShrink: 0, background: "#FFFFFF", borderRight: "1px solid #DCD8CC", minHeight: "calc(100vh - 78px)", padding: "22px 18px" }}>
          <div className="sg" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "#6B6458", marginBottom: 12 }}>
            Setores
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {setores.map((s) => {
              const Meta = setoresConfig[s] || { icon: Package, color: "#6B6458" };
              const ativo = setoresAtivos.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSetor(s)}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "8px 10px",
                    borderRadius: 7, border: "none", textAlign: "left",
                    background: ativo ? `${Meta.color}1A` : "transparent",
                  }}
                >
                  <div style={{ width: 22, height: 22, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", background: ativo ? Meta.color : "#F1EFE8" }}>
                    <Meta.icon size={13} color={ativo ? "#fff" : Meta.color} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: ativo ? 600 : 500, color: ativo ? Meta.color : "#13293D", flex: 1 }}>{s}</span>
                  <span className="mono" style={{ fontSize: 11, color: "#948E7F" }}>{contagemSetor[s] || 0}</span>
                </button>
              );
            })}
          </div>
          {setoresAtivos.size > 0 && (
            <button onClick={() => setSetoresAtivos(new Set())} style={{ marginTop: 12, fontSize: 12, color: "#B8863B", background: "none", border: "none", fontWeight: 600 }}>
              Limpar filtro de setor
            </button>
          )}
          <NovoSetorForm onAdicionar={handleAdicionarSetor} />

          <div style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid #EEECE1" }}>
            <div className="sg" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "#6B6458", marginBottom: 12 }}>
              Emprestado a
            </div>
            {Object.keys(orgaosMap).length === 0 ? (
              <div style={{ fontSize: 12, color: "#948E7F" }}>Nenhum empréstimo registrado ainda.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {Object.entries(orgaosMap).map(([org, info]) => {
                  const ativo = orgaoFiltro === org;
                  return (
                    <div key={org} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        onClick={() => toggleOrgaoFiltro(org)}
                        style={{
                          flex: 1, textAlign: "left", padding: "7px 9px", borderRadius: 7, border: "none",
                          background: ativo ? "#B8863B1A" : "transparent",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: ativo ? 600 : 500, color: ativo ? "#B8863B" : "#13293D", lineHeight: 1.3 }}>{org}</div>
                        <div style={{ fontSize: 10.5, color: "#948E7F" }}>{info.abertos} em aberto · {info.total} no total</div>
                      </button>
                      <button
                        onClick={() => setHistoricoAlvo({ tipo: "orgao", valor: org, titulo: org })}
                        title="Ver histórico do órgão"
                        style={{ background: "none", border: "none", padding: 4, color: "#948E7F" }}
                      >
                        <Clock size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {orgaoFiltro && (
              <button onClick={() => setOrgaoFiltro(null)} style={{ marginTop: 10, fontSize: 12, color: "#B8863B", background: "none", border: "none", fontWeight: 600 }}>
                Limpar filtro de órgão
              </button>
            )}
          </div>

          <div style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid #EEECE1" }}>
            <div className="sg" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "#6B6458", marginBottom: 10 }}>
              Resumo
            </div>
            <SummaryLine label="Itens no acervo" value={materiais.length} />
            <SummaryLine label="Disponíveis" value={materiais.filter((m) => m.status === "Disponível").length} color="#1F6F64" />
            <SummaryLine label="Emprestados" value={materiais.filter((m) => m.status === "Emprestado").length} color="#A6472F" />
          </div>
        </aside>

        <main className="paper-bg" style={{ flex: 1, padding: "24px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div className="sg" style={{ fontSize: 15, fontWeight: 600 }}>
              {carregando ? "Sincronizando com a nuvem..." : `${filtrados.length} ${filtrados.length === 1 ? "item" : "itens"} no estoque`}
            </div>
            {orgaoFiltro && (
              <div style={{ fontSize: 12.5, color: "#6B6458" }}>
                Mostrando materiais emprestados a: <strong style={{ color: "#13293D" }}>{orgaoFiltro}</strong>
              </div>
            )}
          </div>

          {!carregando && filtrados.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#948E7F" }}>
              Nenhum material encontrado com esses filtros.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
              {filtrados.map((m) => (
                <MaterialCard
                  key={m.id}
                  material={m}
                  setoresConfig={setoresConfig}
                  orgaoAtual={m.orgaoAtual}
                  emCesta={!!cesta.find((c) => c.id === m.id)}
                  onEmprestar={() => addNaCesta(m)}
                  onEditar={() => setModalMaterial({ mode: "editar", data: m })}
                  onExcluir={() => handleExcluirMaterial(m.id)}
                  onHistorico={() => setHistoricoAlvo({ tipo: "material", valor: m.id, titulo: m.nome })}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {painelCesta && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(19,41,61,0.35)", display: "flex", justifyContent: "flex-end", zIndex: 40 }} onClick={() => setPainelCesta(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 380, background: "#FFFFFF", height: "100%", padding: 24, overflowY: "auto", boxShadow: "-4px 0 14px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div className="sg" style={{ fontSize: 16, fontWeight: 600 }}>Cesta de empréstimo</div>
              <button onClick={() => setPainelCesta(false)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>

            {cesta.length === 0 ? (
              <div style={{ color: "#948E7F", fontSize: 13.5 }}>Nenhum material selecionado. Clique em "Emprestar" nos cartões para adicionar itens aqui.</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                  {cesta.map((item) => (
                    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #EEECE1", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.nome}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: "#948E7F" }}>Nº {item.patrimonio}</div>
                      </div>
                      <button onClick={() => removeDaCesta(item.id)} style={{ background: "none", border: "none", color: "#A6472F" }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="sg" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "#6B6458", marginBottom: 10 }}>
                  Dados do empréstimo
                </div>
                <FieldInput label="Órgão / destinatário" value={formEmprestimo.orgao} onChange={(v) => setFormEmprestimo((f) => ({ ...f, orgao: v }))} icon={Building2} placeholder="Ex: Marinha do Brasil - 2º DN" />
                <FieldInput label="Responsável no órgão" value={formEmprestimo.solicitante} onChange={(v) => setFormEmprestimo((f) => ({ ...f, solicitante: v }))} icon={User} placeholder="Nome do solicitante" />
                <FieldInput label="Prazo de devolução" value={formEmprestimo.prazo} onChange={(v) => setFormEmprestimo((f) => ({ ...f, prazo: v }))} icon={Calendar} type="date" />

                <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginTop: 10, marginBottom: 5 }}>
                  Data/hora da mensagem de formalização
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #DCD8CC", borderRadius: 7, padding: "8px 10px", marginBottom: 4 }}>
                  <Clock size={14} color="#948E7F" />
                  <input
                    type="datetime-local"
                    value={formEmprestimo.dataFormalizacao}
                    onChange={(e) => setFormEmprestimo((f) => ({ ...f, dataFormalizacao: e.target.value }))}
                    style={{ border: "none", outline: "none", fontSize: 13, width: "100%" }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "#948E7F", marginBottom: 10 }}>
                  Se ainda não tiver essa informação, deixe em branco — dá para preencher depois no histórico.
                </div>

                <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginBottom: 6 }}>Observações</label>
                <textarea
                  value={formEmprestimo.observacoes}
                  onChange={(e) => setFormEmprestimo((f) => ({ ...f, observacoes: e.target.value }))}
                  rows={2}
                  style={{ width: "100%", border: "1px solid #DCD8CC", borderRadius: 7, padding: "8px 10px", fontSize: 13, resize: "vertical" }}
                  placeholder="Condições do material, finalidade, etc."
                />

                {erroEmprestimo && (
                  <div style={{ color: "#A6472F", fontSize: 12, marginTop: 10 }}>{erroEmprestimo}</div>
                )}

                <button
                  onClick={confirmarEmprestimo}
                  disabled={!formEmprestimo.orgao || !formEmprestimo.solicitante || enviandoEmprestimo}
                  style={{
                    marginTop: 18, width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
                    background: formEmprestimo.orgao && formEmprestimo.solicitante ? "#13293D" : "#DCD8CC",
                    color: "#F5F4EF", fontWeight: 600, fontSize: 13.5,
                  }}
                >
                  {enviandoEmprestimo ? "Gravando na nuvem..." : "Confirmar empréstimo e gerar recibo"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {recibo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(19,41,61,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#fff", width: 480, maxHeight: "88vh", overflowY: "auto", borderRadius: 10, padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div>
                <div className="sg" style={{ fontSize: 17, fontWeight: 600 }}>Recibo de empréstimo</div>
                <div className="mono" style={{ fontSize: 11.5, color: "#948E7F" }}>{recibo.numeroRecibo}</div>
              </div>
              <button onClick={() => setRecibo(null)} style={{ background: "none", border: "none" }}><X size={18} /></button>
            </div>

            <div style={{ margin: "16px 0", padding: "12px 0", borderTop: "1px solid #EEECE1", borderBottom: "1px solid #EEECE1" }}>
              <ReciboLinha label="Órgão / destinatário" value={recibo.orgao} />
              <ReciboLinha label="Responsável" value={recibo.solicitante} />
              {recibo.prazo && <ReciboLinha label="Prazo de devolução" value={formatarData(recibo.prazo)} />}
              <ReciboLinha
                label="Formalização"
                value={recibo.dataFormalizacao ? formatarDataHora(recibo.dataFormalizacao) : "Não informada — poderá ser adicionada depois"}
              />
            </div>

            <div className="sg" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "#6B6458", marginBottom: 8 }}>Material emprestado</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {(recibo.itens || []).map((it) => (
                <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, borderBottom: "1px dashed #EEECE1", paddingBottom: 6 }}>
                  <span>{it.nome}</span>
                  <span className="mono" style={{ color: "#948E7F" }}>{it.patrimonio}</span>
                </div>
              ))}
            </div>

            {recibo.observacoes && (
              <div style={{ fontSize: 12, color: "#6B6458", marginBottom: 16 }}>
                <strong>Obs.:</strong> {recibo.observacoes}
              </div>
            )}

            <div style={{ display: "flex", gap: 40, marginTop: 30 }}>
              <div style={{ flex: 1, borderTop: "1px solid #13293D", paddingTop: 6, fontSize: 11, textAlign: "center", color: "#6B6458" }}>Assinatura do gerente</div>
              <div style={{ flex: 1, borderTop: "1px solid #13293D", paddingTop: 6, fontSize: 11, textAlign: "center", color: "#6B6458" }}>Assinatura do responsável</div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button onClick={() => window.print()} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 8, border: "1px solid #DCD8CC", background: "#fff", fontSize: 13, fontWeight: 600 }}>
                <Printer size={15} /> Imprimir
              </button>
              <button onClick={() => setRecibo(null)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#13293D", color: "#fff", fontSize: 13, fontWeight: 600 }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalMaterial && (
        <MaterialModal
          modo={modalMaterial.mode}
          dadosIniciais={modalMaterial.data}
          setoresConfig={setoresConfig}
          onAdicionarSetor={handleAdicionarSetor}
          onCancelar={() => setModalMaterial(null)}
          onSalvar={handleSalvarMaterial}
        />
      )}

      {modalImportar && (
        <ImportarModal
          patrimoniosExistentes={materiais.map((m) => m.patrimonio)}
          onCancelar={() => setModalImportar(false)}
          onImportarArquivo={handleImportarArquivo}
        />
      )}

      {historicoAlvo && (
        <HistoricoModal
          alvo={historicoAlvo}
          emprestimosList={emprestimosList}
          onFechar={() => setHistoricoAlvo(null)}
          onAtualizarFormalizacao={handleAtualizarFormalizacao}
          onRegistrarDevolucao={handleRegistrarDevolucao}
        />
      )}
    </div>
  );
}

function SummaryLine({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
      <span style={{ color: "#6B6458" }}>{label}</span>
      <span className="mono" style={{ fontWeight: 600, color: color || "#13293D" }}>{value}</span>
    </div>
  );
}

function ReciboLinha({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", gap: 12 }}>
      <span style={{ color: "#6B6458" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function FieldInput({ label, value, onChange, icon: Icon, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginBottom: 5 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #DCD8CC", borderRadius: 7, padding: "8px 10px" }}>
        {Icon && <Icon size={14} color="#948E7F" />}
        <input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ border: "none", outline: "none", fontSize: 13, width: "100%" }}
        />
      </div>
    </div>
  );
}

function NovoSetorForm({ onAdicionar }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");

  const confirmar = () => {
    if (!nome.trim()) return;
    onAdicionar(nome);
    setNome("");
    setAberto(false);
  };

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10, background: "none", border: "none", color: "#B8863B", fontSize: 12, fontWeight: 600 }}
      >
        <Plus size={13} /> Novo setor
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && confirmar()}
        placeholder="Ex: Informática"
        autoFocus
        style={{ flex: 1, minWidth: 0, border: "1px solid #DCD8CC", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
      />
      <button onClick={confirmar} style={{ background: "#13293D", color: "#fff", border: "none", borderRadius: 6, padding: "0 10px", fontSize: 11.5, fontWeight: 600 }}>
        <Check size={13} />
      </button>
      <button onClick={() => { setAberto(false); setNome(""); }} style={{ background: "none", border: "1px solid #DCD8CC", borderRadius: 6, padding: "0 8px" }}>
        <X size={12} />
      </button>
    </div>
  );
}

function MaterialCard({ material, setoresConfig, orgaoAtual, emCesta, onEmprestar, onEditar, onExcluir, onHistorico }) {
  const Meta = setoresConfig[material.setor] || { icon: Package, color: "#6B6458" };
  const StatusMeta = STATUS_META[material.status] || STATUS_META.Disponível;
  const EstadoMeta = ESTADO_META[material.estado] || ESTADO_META.Bom;
  const disponivel = material.status === "Disponível";

  return (
    <div style={{ background: "#fff", border: "1px solid #E4E1D5", borderRadius: 10, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 5, zIndex: 2 }}>
        <button onClick={onHistorico} title="Histórico do material" style={{ background: "#fff", border: "1px solid #E4E1D5", borderRadius: 6, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Clock size={12} color="#6B6458" />
        </button>
        <button onClick={onEditar} title="Editar" style={{ background: "#fff", border: "1px solid #E4E1D5", borderRadius: 6, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Pencil size={12} color="#6B6458" />
        </button>
        <button onClick={onExcluir} title="Excluir" style={{ background: "#fff", border: "1px solid #E4E1D5", borderRadius: 6, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Trash2 size={12} color="#A6472F" />
        </button>
      </div>

      <div style={{ height: 96, background: `${Meta.color}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Meta.icon size={34} color={Meta.color} strokeWidth={1.5} />
      </div>

      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{material.nome}</span>
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: "#fff", background: "#13293D", borderRadius: 4, padding: "3px 5px", whiteSpace: "nowrap" }}>
            {material.patrimonio}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6B6458" }}>
          <MapPin size={11} /> {material.localizacao || "—"}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: Meta.color, background: `${Meta.color}14`, borderRadius: 5, padding: "3px 7px" }}>{material.setor}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: StatusMeta.color, background: StatusMeta.bg, borderRadius: 5, padding: "3px 7px" }}>{material.status}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: EstadoMeta.color, background: EstadoMeta.bg, borderRadius: 5, padding: "3px 7px" }}>{material.estado}</span>
        </div>

        {orgaoAtual && (
          <div style={{ fontSize: 10.5, color: "#A6472F" }}>Emprestado a: <strong>{orgaoAtual}</strong></div>
        )}

        <button
          onClick={onEmprestar}
          disabled={!disponivel || emCesta}
          style={{
            marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 0", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 600,
            background: emCesta ? "#E4F0EC" : disponivel ? "#B8863B" : "#F1EFE8",
            color: emCesta ? "#1F6F64" : disponivel ? "#13293D" : "#948E7F",
          }}
        >
          {emCesta ? (<><Check size={13} /> Na cesta</>) : disponivel ? "Emprestar" : (<><AlertCircle size={12} /> Indisponível</>)}
        </button>
      </div>
    </div>
  );
}

function MaterialModal({ modo, dadosIniciais, setoresConfig, onAdicionarSetor, onCancelar, onSalvar }) {
  const [form, setForm] = useState(dadosIniciais);
  const [criandoSetor, setCriandoSetor] = useState(false);
  const [novoSetorNome, setNovoSetorNome] = useState("");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const confirmarNovoSetor = () => {
    const nome = novoSetorNome.trim();
    if (!nome) return;
    onAdicionarSetor(nome);
    setField("setor", nome);
    setNovoSetorNome("");
    setCriandoSetor(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(19,41,61,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onCancelar}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 420, borderRadius: 10, padding: 24, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="sg" style={{ fontSize: 16, fontWeight: 600 }}>{modo === "novo" ? "Novo material" : "Editar material"}</div>
          <button onClick={onCancelar} style={{ background: "none", border: "none" }}><X size={18} /></button>
        </div>

        <FieldInput label="Nome do material" value={form.nome} onChange={(v) => setField("nome", v)} placeholder="Ex: Estação Total Leica TS16" />
        <FieldInput label="Número patrimonial" value={form.patrimonio} onChange={(v) => setField("patrimonio", v)} placeholder="Ex: 2024.0001" />

        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginBottom: 5 }}>Setor</label>
        {!criandoSetor ? (
          <>
            <select value={form.setor} onChange={(e) => setField("setor", e.target.value)} style={{ width: "100%", border: "1px solid #DCD8CC", borderRadius: 7, padding: "9px 10px", fontSize: 13, marginBottom: 6 }}>
              {Object.keys(setoresConfig).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => setCriandoSetor(true)}
              style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#B8863B", fontSize: 12, fontWeight: 600, marginBottom: 10 }}
            >
              <Plus size={13} /> Criar novo setor
            </button>
          </>
        ) : (
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input
              value={novoSetorNome}
              onChange={(e) => setNovoSetorNome(e.target.value)}
              placeholder="Ex: Informática"
              autoFocus
              style={{ flex: 1, border: "1px solid #DCD8CC", borderRadius: 7, padding: "8px 10px", fontSize: 13 }}
            />
            <button onClick={confirmarNovoSetor} style={{ background: "#13293D", color: "#fff", border: "none", borderRadius: 7, padding: "0 12px", fontSize: 12, fontWeight: 600 }}>Criar</button>
            <button onClick={() => { setCriandoSetor(false); setNovoSetorNome(""); }} style={{ background: "none", border: "1px solid #DCD8CC", borderRadius: 7, padding: "0 10px", fontSize: 12 }}>
              <X size={13} />
            </button>
          </div>
        )}

        <FieldInput label="Localização (prateleira)" value={form.localizacao} onChange={(v) => setField("localizacao", v)} icon={MapPin} placeholder="Ex: Prateleira A3" />

        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginBottom: 5 }}>Status</label>
        <select value={form.status} onChange={(e) => setField("status", e.target.value)} style={{ width: "100%", border: "1px solid #DCD8CC", borderRadius: 7, padding: "9px 10px", fontSize: 13, marginBottom: 10 }}>
          {Object.keys(STATUS_META).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginBottom: 5 }}>Estado de conservação</label>
        <select value={form.estado} onChange={(e) => setField("estado", e.target.value)} style={{ width: "100%", border: "1px solid #DCD8CC", borderRadius: 7, padding: "9px 10px", fontSize: 13, marginBottom: 10 }}>
          {Object.keys(ESTADO_META).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "block", marginBottom: 5 }}>Descrição</label>
        <textarea value={form.descricao} onChange={(e) => setField("descricao", e.target.value)} rows={2} style={{ width: "100%", border: "1px solid #DCD8CC", borderRadius: 7, padding: "8px 10px", fontSize: 13, marginBottom: 16, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancelar} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #DCD8CC", background: "#fff", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
          <button
            onClick={() => form.nome && form.patrimonio && onSalvar(form)}
            disabled={!form.nome || !form.patrimonio}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: form.nome && form.patrimonio ? "#13293D" : "#DCD8CC", color: "#fff", fontSize: 13, fontWeight: 600 }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function FormalizacaoField({ emprestimo, onSalvar }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(emprestimo.dataFormalizacao || "");

  if (emprestimo.dataFormalizacao && !editando) {
    return (
      <div style={{ fontSize: 11.5, color: "#6B6458", display: "flex", alignItems: "center", gap: 6 }}>
        Formalização: <strong style={{ color: "#13293D" }}>{formatarDataHora(emprestimo.dataFormalizacao)}</strong>
        <button onClick={() => setEditando(true)} style={{ background: "none", border: "none", color: "#B8863B", fontSize: 11, fontWeight: 600 }}>Alterar</button>
      </div>
    );
  }

  if (editando) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="datetime-local" value={valor} onChange={(e) => setValor(e.target.value)} style={{ fontSize: 12, border: "1px solid #DCD8CC", borderRadius: 6, padding: "4px 6px" }} />
        <button onClick={() => { onSalvar(emprestimo.id, valor); setEditando(false); }} style={{ background: "#13293D", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600 }}>Salvar</button>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 11.5, color: "#A6472F", display: "flex", alignItems: "center", gap: 6 }}>
      Formalização não informada
      <button onClick={() => setEditando(true)} style={{ background: "none", border: "none", color: "#B8863B", fontSize: 11, fontWeight: 600 }}>Adicionar</button>
    </div>
  );
}

function HistoricoModal({ alvo, emprestimosList, onFechar, onAtualizarFormalizacao, onRegistrarDevolucao }) {
  const lista = useMemo(() => {
    if (alvo.tipo === "material") {
      return emprestimosList.filter((e) => (e.itens || []).includes(alvo.valor));
    } else {
      return emprestimosList.filter((e) => e.orgao === alvo.valor);
    }
  }, [alvo, emprestimosList]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(19,41,61,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }} onClick={onFechar}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 500, maxHeight: "85vh", overflowY: "auto", borderRadius: 10, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div className="sg" style={{ fontSize: 16, fontWeight: 600 }}>Histórico de empréstimos</div>
            <div style={{ fontSize: 12.5, color: "#6B6458" }}>{alvo.titulo}</div>
          </div>
          <button onClick={onFechar} style={{ background: "none", border: "none" }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {lista.length === 0 && <div style={{ fontSize: 13, color: "#948E7F" }}>Nenhum empréstimo registrado.</div>}

          {lista.map((e) => {
            const emAberto = e.status === "Em aberto";
            return (
              <div key={e.id} style={{ border: "1px solid #EEECE1", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div>
                    {alvo.tipo === "material" ? (
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{e.orgao}</div>
                    ) : (
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{(e.itensDetalhados || []).map((i) => i.nome).join(", ")}</div>
                    )}
                    <div className="mono" style={{ fontSize: 10.5, color: "#948E7F" }}>{e.numeroRecibo}</div>
                  </div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 600, borderRadius: 5, padding: "3px 7px",
                    color: emAberto ? "#A6472F" : "#1F6F64", background: emAberto ? "#F5E7E2" : "#E4F0EC",
                  }}>
                    {e.status}
                  </span>
                </div>

                <div style={{ fontSize: 11.5, color: "#6B6458", marginBottom: 4 }}>
                  Solicitante: <strong style={{ color: "#13293D" }}>{e.solicitante}</strong>
                </div>
                <div style={{ fontSize: 11.5, color: "#6B6458", marginBottom: 4 }}>
                  Registrado em {formatarDataHora(e.dataEmprestimo)}
                  {e.prazo && <> · prazo {formatarData(e.prazo)}</>}
                  {e.dataDevolucao && <> · devolvido em {formatarDataHora(e.dataDevolucao)}</>}
                </div>

                <div style={{ marginTop: 6, marginBottom: 6 }}>
                  <FormalizacaoField emprestimo={e} onSalvar={onAtualizarFormalizacao} />
                </div>

                {e.observacoes && <div style={{ fontSize: 11.5, color: "#6B6458", marginBottom: 6 }}>Obs.: {e.observacoes}</div>}

                {emAberto && (
                  <button
                    onClick={() => onRegistrarDevolucao(e)}
                    style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, background: "none", border: "1px solid #DCD8CC", borderRadius: 6, padding: "5px 9px", fontSize: 11.5, fontWeight: 600, color: "#13293D" }}
                  >
                    <RotateCcw size={12} /> Registrar devolução
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ImportarModal({ patrimoniosExistentes, onCancelar, onImportarArquivo }) {
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [linhas, setLinhas] = useState([]);
  const [erroArquivo, setErroArquivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const baixarModelo = () => {
    const conteudo =
      "nome,numero_patrimonial,setor,localizacao,estado,status,descricao\n" +
      "Estação Total Leica TS16,2024.0001,Topografia,Prateleira C1,Bom,Disponível,Estação robótica de precisão\n";
    const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo_materiais.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleArquivo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setNomeArquivo(file.name);
    setErroArquivo("");
    setResultado(null);
    setLinhas([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        const vistos = new Set(patrimoniosExistentes);
        const processadas = r.data.map((row, idx) => {
          const mapa = mapearLinhaCSV(row);
          const nome = mapa.nome || "";
          const patrimonio = mapa.patrimonio || "";
          let motivoErro = "";
          if (!nome) motivoErro = "Nome ausente";
          else if (!patrimonio) motivoErro = "Nº patrimonial ausente";
          else if (vistos.has(patrimonio)) motivoErro = "Patrimônio duplicado";
          if (!motivoErro) vistos.add(patrimonio);
          return {
            linha: idx + 2,
            nome,
            patrimonio,
            setor: mapa.setor || "Outros",
            localizacao: mapa.localizacao || "—",
            estado: mapa.estado || "Bom",
            status: mapa.status || "Disponível",
            descricao: mapa.descricao || "",
            valido: !motivoErro,
            motivoErro
          };
        });
        setLinhas(processadas);
      },
      error: (err) => setErroArquivo("Não foi possível ler o arquivo: " + err.message),
    });
  };

  const confirmarImportacao = async () => {
    const validas = linhas.filter((l) => l.valido);
    if (validas.length === 0) return;
    setEnviando(true);
    setErroArquivo("");
    try {
      const resp = await onImportarArquivo(validas);
      setResultado(resp);
    } catch (err) {
      setErroArquivo("Falha ao importar: " + err.message);
    } finally {
      setEnviando(false);
    }
  };

  const validas = linhas.filter((l) => l.valido);
  const invalidas = linhas.filter((l) => !l.valido);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(19,41,61,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onCancelar}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 640, maxHeight: "88vh", overflowY: "auto", borderRadius: 10, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="sg" style={{ fontSize: 16, fontWeight: 600 }}>Importar planilha de materiais</div>
          <button onClick={onCancelar} style={{ background: "none", border: "none" }}><X size={18} /></button>
        </div>

        {resultado ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1F6F64", marginBottom: 8 }}>
              {resultado.importados} {resultado.importados === 1 ? "material importado" : "materiais importados"} com sucesso para o Firebase.
            </div>
            {resultado.erros?.length > 0 && (
              <>
                <div style={{ fontSize: 12.5, color: "#A6472F", fontWeight: 600, marginBottom: 6 }}>{resultado.erros.length} linha(s) não importada(s):</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                  {resultado.erros.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#6B6458" }}>Linha {e.linha}: {e.motivo}</div>
                  ))}
                </div>
              </>
            )}
            <button onClick={onCancelar} style={{ marginTop: 10, width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "#13293D", color: "#fff", fontSize: 13, fontWeight: 600 }}>
              Concluir
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: "#6B6458", marginBottom: 16 }}>
              Envie um arquivo .csv exportado do Excel ou Google Sheets. As colunas reconhecidas são: nome, numero_patrimonial, setor, localizacao, estado, status e descricao (identificadas automaticamente pelo nome).
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <label style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "1.5px dashed #DCD8CC", borderRadius: 8, padding: "16px 10px", fontSize: 13, fontWeight: 600, color: "#13293D", cursor: "pointer" }}>
                <FileSpreadsheet size={16} color="#B8863B" />
                {nomeArquivo || "Escolher arquivo .csv"}
                <input type="file" accept=".csv" onChange={handleArquivo} style={{ display: "none" }} />
              </label>
              <button onClick={baixarModelo} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #DCD8CC", borderRadius: 8, padding: "0 14px", fontSize: 12.5, fontWeight: 600, background: "#fff", color: "#13293D" }}>
                <Download size={14} /> Baixar modelo
              </button>
            </div>

            {erroArquivo && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#A6472F", fontSize: 12.5, marginBottom: 12 }}>
                <AlertTriangle size={14} /> {erroArquivo}
              </div>
            )}

            {linhas.length > 0 && (
              <>
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, marginBottom: 10 }}>
                  <span style={{ color: "#1F6F64", fontWeight: 600 }}>{validas.length} prontas para importar</span>
                  {invalidas.length > 0 && <span style={{ color: "#A6472F", fontWeight: 600 }}>{invalidas.length} com problema</span>}
                </div>

                <div style={{ border: "1px solid #EEECE1", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ maxHeight: 220, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#F5F4EF", textAlign: "left" }}>
                          <th style={{ padding: "7px 9px" }}>Linha</th>
                          <th style={{ padding: "7px 9px" }}>Nome</th>
                          <th style={{ padding: "7px 9px" }}>Patrimônio</th>
                          <th style={{ padding: "7px 9px" }}>Setor</th>
                          <th style={{ padding: "7px 9px" }}>Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((l) => (
                          <tr key={l.linha} style={{ borderTop: "1px solid #EEECE1", background: l.valido ? "transparent" : "#F5E7E2" }}>
                            <td className="mono" style={{ padding: "6px 9px", color: "#948E7F" }}>{l.linha}</td>
                            <td style={{ padding: "6px 9px" }}>{l.nome || "—"}</td>
                            <td className="mono" style={{ padding: "6px 9px" }}>{l.patrimonio || "—"}</td>
                            <td style={{ padding: "6px 9px" }}>{l.setor}</td>
                            <td style={{ padding: "6px 9px", color: l.valido ? "#1F6F64" : "#A6472F", fontWeight: 600 }}>{l.valido ? "OK" : l.motivoErro}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onCancelar} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #DCD8CC", background: "#fff", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
              <button
                onClick={confirmarImportacao}
                disabled={validas.length === 0 || enviando}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: validas.length > 0 ? "#13293D" : "#DCD8CC", color: "#fff", fontSize: 13, fontWeight: 600 }}
              >
                {enviando ? "Importando para Firebase..." : `Importar ${validas.length > 0 ? `${validas.length} itens` : ""}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

