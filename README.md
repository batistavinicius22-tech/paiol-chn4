# Paiol CHN-4 — Frontend

Projeto React (Vite) com a interface do catálogo do paiol técnico, já conectado à API do backend.

## Como rodar

Precisa de Node.js 18+. São dois projetos separados (frontend e backend) rodando ao mesmo tempo,
em dois terminais.

**Terminal 1 — backend:**
```bash
cd paiol-backend
npm install
npm start
```
Sobe a API em `http://localhost:3001`.

**Terminal 2 — frontend:**
```bash
cd paiol-frontend
npm install
npm run dev
```
Abre em `http://localhost:5173`. O Vite mostra o link exato no terminal.

Se o backend estiver rodando em outro endereço (ex: em produção), ajuste a constante `API_BASE_URL`
no topo de `src/App.jsx`.

## Estrutura

```
paiol-frontend/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx      # ponto de entrada, monta o <App />
    └── App.jsx        # toda a interface (catálogo, filtros, empréstimos, importação, histórico)
```

## Build para produção

```bash
npm run build
```
Gera a pasta `dist/` com os arquivos estáticos prontos para hospedar em qualquer servidor web
(nginx, Apache, um bucket S3 com site estático, etc.) — junto com a API rodando à parte.

## Deploy

Para o uso real no CHN-4: hospedar o `dist/` gerado aqui em qualquer servidor web interno, e o
`paiol-backend` (com o `paiol.db`) numa VM ou container na mesma rede, acessível só internamente
(VPN ou rede local) já que não há autenticação de usuário implementada — o sistema assume um único
gestor operando.
