import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAKDKWvSQDJEyoHjAsDCCMjW4Jr30BbA6w",
  authDomain: "paiol-chn4.firebaseapp.com",
  projectId: "paiol-chn4",
  storageBucket: "paiol-chn4.firebasestorage.app",
  messagingSenderId: "664195910298",
  appId: "1:664195910298:web:023e176fb70a7fa500ad23"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const SETORES_INICIAIS = [
  { nome: "Hidrografia", cor: "#1F6F64" },
  { nome: "Topografia", cor: "#8B6B2E" },
  { nome: "Maregrafia", cor: "#2C5F7C" },
  { nome: "Geodésia", cor: "#5C6B47" }
];

// Inicializa setores padrão caso a coleção esteja vazia
export async function inicializarSetoresPadrao() {
  try {
    const snap = await getDocs(collection(db, "setores"));
    if (snap.empty) {
      const batch = writeBatch(db);
      SETORES_INICIAIS.forEach((s) => {
        const ref = doc(collection(db, "setores"));
        batch.set(ref, s);
      });
      await batch.commit();
    }
  } catch (err) {
    console.error("Erro ao inicializar setores:", err);
  }
}

// Inscrição em tempo real para Setores
export function subscribeSetores(callback) {
  const q = query(collection(db, "setores"), orderBy("nome"));
  return onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      inicializarSetoresPadrao();
    }
    const setores = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(setores);
  }, (err) => {
    console.error("Erro ao escutar setores:", err);
  });
}

// Inscrição em tempo real para Materiais
export function subscribeMateriais(callback) {
  const q = query(collection(db, "materiais"));
  return onSnapshot(q, (snapshot) => {
    const materiais = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((m) => m.ativo !== false)
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    callback(materiais);
  }, (err) => {
    console.error("Erro ao escutar materiais:", err);
  });
}

// Inscrição em tempo real para Empréstimos
export function subscribeEmprestimos(callback) {
  const q = query(collection(db, "emprestimos"));
  return onSnapshot(q, (snapshot) => {
    const emprestimos = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.dataEmprestimo || 0) - new Date(a.dataEmprestimo || 0));
    callback(emprestimos);
  }, (err) => {
    console.error("Erro ao escutar empréstimos:", err);
  });
}

// Criar novo setor
export async function addSetor(nome, cor = "#6B6458") {
  const nomeTrim = (nome || "").trim();
  if (!nomeTrim) return;
  const snap = await getDocs(query(collection(db, "setores"), where("nome", "==", nomeTrim)));
  if (!snap.empty) {
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  const ref = await addDoc(collection(db, "setores"), { nome: nomeTrim, cor });
  return { id: ref.id, nome: nomeTrim, cor };
}

// Salvar / Atualizar Material
export async function saveMaterial(dados, isNovo) {
  if (isNovo) {
    // Validação de patrimônio duplicado
    const snap = await getDocs(query(
      collection(db, "materiais"),
      where("patrimonio", "==", dados.patrimonio.trim())
    ));
    const ativoDuplicado = snap.docs.find((d) => d.data().ativo !== false);
    if (ativoDuplicado) {
      throw new Error("Já existe um material ativo cadastrado com este número patrimonial.");
    }

    const docRef = await addDoc(collection(db, "materiais"), {
      nome: dados.nome.trim(),
      patrimonio: dados.patrimonio.trim(),
      setor: dados.setor,
      localizacao: dados.localizacao || "—",
      status: dados.status || "Disponível",
      estado: dados.estado || "Bom",
      descricao: dados.descricao || "",
      ativo: true,
      dataCadastro: new Date().toISOString()
    });

    await addDoc(collection(db, "historico"), {
      materialId: docRef.id,
      tipo: "entrada",
      observacao: "Cadastro manual",
      data: new Date().toISOString()
    });

    return docRef.id;
  } else {
    const docRef = doc(db, "materiais", dados.id);
    await updateDoc(docRef, {
      nome: dados.nome.trim(),
      patrimonio: dados.patrimonio.trim(),
      setor: dados.setor,
      localizacao: dados.localizacao || "—",
      status: dados.status,
      estado: dados.estado,
      descricao: dados.descricao || ""
    });
  }
}

// Excluir material (soft delete)
export async function deleteMaterial(id) {
  const docRef = doc(db, "materiais", id);
  await updateDoc(docRef, { ativo: false });
  await addDoc(collection(db, "historico"), {
    materialId: id,
    tipo: "baixa",
    observacao: "Excluído pelo gestor",
    data: new Date().toISOString()
  });
}

// Confirmar Empréstimo
export async function createEmprestimo({ orgao, solicitante, itens, prazo, dataFormalizacao, observacoes }) {
  const batch = writeBatch(db);
  const numeroRecibo = `REC-${Date.now().toString().slice(-6)}`;
  const empRef = doc(collection(db, "emprestimos"));

  const emprestimoData = {
    numeroRecibo,
    orgao: orgao.trim(),
    solicitante: solicitante.trim(),
    dataEmprestimo: new Date().toISOString(),
    dataFormalizacao: dataFormalizacao || null,
    prazo: prazo || null,
    dataDevolucao: null,
    status: "Em aberto",
    observacoes: observacoes || "",
    itens: itens.map((i) => i.id),
    itensDetalhados: itens.map((i) => ({
      id: i.id,
      nome: i.nome,
      patrimonio: i.patrimonio
    }))
  };

  batch.set(empRef, emprestimoData);

  // Atualiza cada material para 'Emprestado'
  itens.forEach((it) => {
    const mRef = doc(db, "materiais", it.id);
    batch.update(mRef, {
      status: "Emprestado",
      orgaoAtual: orgao.trim()
    });

    const histRef = doc(collection(db, "historico"));
    batch.set(histRef, {
      materialId: it.id,
      tipo: "saida_emprestimo",
      observacao: `Emprestado para ${orgao.trim()} (${numeroRecibo})`,
      data: new Date().toISOString()
    });
  });

  await batch.commit();
  return { id: empRef.id, ...emprestimoData };
}

// Atualizar mensagem de formalização
export async function updateFormalizacao(emprestimoId, dataFormalizacao) {
  const empRef = doc(db, "emprestimos", emprestimoId);
  await updateDoc(empRef, { dataFormalizacao });
}

// Registrar Devolução
export async function registrarDevolucao(emprestimo) {
  const batch = writeBatch(db);
  const empRef = doc(db, "emprestimos", emprestimo.id);

  batch.update(empRef, {
    status: "Devolvido",
    dataDevolucao: new Date().toISOString()
  });

  (emprestimo.itensDetalhados || []).forEach((it) => {
    const mRef = doc(db, "materiais", it.id);
    batch.update(mRef, {
      status: "Disponível",
      orgaoAtual: null
    });

    const histRef = doc(collection(db, "historico"));
    batch.set(histRef, {
      materialId: it.id,
      tipo: "devolucao",
      observacao: `Devolução do empréstimo ${emprestimo.numeroRecibo}`,
      data: new Date().toISOString()
    });
  });

  await batch.commit();
}

// Importar materiais em lote via CSV
export async function importarMateriaisFirestore(linhasValidas) {
  // Obter patrimônios existentes para garantia
  const snap = await getDocs(collection(db, "materiais"));
  const existentes = new Set(
    snap.docs.filter((d) => d.data().ativo !== false).map((d) => d.data().patrimonio)
  );

  const batch = writeBatch(db);
  let importados = 0;
  const erros = [];

  for (const l of linhasValidas) {
    if (existentes.has(l.patrimonio)) {
      erros.push({ linha: l.linha, motivo: "Patrimônio duplicado no banco" });
      continue;
    }

    const docRef = doc(collection(db, "materiais"));
    batch.set(docRef, {
      nome: l.nome,
      patrimonio: l.patrimonio,
      setor: l.setor || "Outros",
      localizacao: l.localizacao || "—",
      status: l.status || "Disponível",
      estado: l.estado || "Bom",
      descricao: l.descricao || "",
      ativo: true,
      dataCadastro: new Date().toISOString()
    });

    const histRef = doc(collection(db, "historico"));
    batch.set(histRef, {
      materialId: docRef.id,
      tipo: "importacao",
      observacao: "Importado via planilha CSV",
      data: new Date().toISOString()
    });

    existentes.add(l.patrimonio);
    importados++;
  }

  if (importados > 0) {
    await batch.commit();
  }

  return { importados, erros };
}
