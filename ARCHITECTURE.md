# Nexus-Git — Documento de Arquitetura

> Aplicativo desktop para rastreabilidade entre **Cards de Requisitos (Issues)** e
> **Branches de Código** no GitLab, gestão manual de erros de desenvolvimento e
> publicação automática de relatórios na **Wiki** do projeto.

**Status:** Fase 0 (fundação) — ainda não iniciado o código.
**Última atualização:** 2026-06-27

---

## 1. Visão geral

O Nexus-Git conecta repositórios do GitLab, configuráveis por projeto:

| Papel | Repositório (exemplo) | Permissão do PAT |
|---|---|---|
| **Origem** (Issues) | `grupo/projeto-de-issues` | Developer |
| **Destino** (Branches + Wiki) | `grupo/projeto-de-codigo` | Maintainer |

Fluxo de valor:

```
[Issues do projeto de origem] ──┐
                                ├──> [UI de Vínculo] ──> [Markdown] ──> [Wiki do projeto]
[Branches do projeto de código] ┘

[Erros cadastrados manualmente] ──> [Markdown] ──> [Wiki do projeto]
```

A URL base do GitLab é **configurável em runtime** (campo na tela de configuração),
suportando tanto `gitlab.com` quanto instâncias self-hosted com CA própria.

---

## 2. Decisões de arquitetura (e por quê)

Estas são as decisões que diferem da sugestão inicial. Cada uma tem justificativa.

### DA-01 — As chamadas ao GitLab são feitas pelo Rust, não pelo Angular
**Decisão:** Todo acesso à API do GitLab passa por **comandos Tauri** (`#[tauri::command]`)
implementados em Rust com `reqwest`. O Angular invoca via `invoke('nome_comando', {...})`.

**Motivos:**
- **Segurança:** o PAT tem permissão de *Maintainer*. Se o Angular chamasse a API
  direto, o token viveria no contexto JS da WebView — exposto a XSS ou a uma
  dependência npm comprometida. Mantendo no Rust, o token **nunca toca o JavaScript**.
- **CORS:** chamadas browser→GitLab self-hosted frequentemente esbarram em CORS.
  O Rust não tem essa restrição.
- **Certificados internos:** instâncias gov self-hosted às vezes usam CA interna;
  o `reqwest` permite configurar isso de forma controlada.

### DA-02 — Token no Windows Credential Manager
**Decisão:** PAT armazenado via crate `keyring` (→ Windows Credential Manager).
Nunca em `localStorage` nem em arquivo texto.

**Motivos:** texto plano em `localStorage` é legível por qualquer JS. O Credential
Manager é o cofre nativo do SO, sem exigir senha mestre adicional.

### DA-03 — Persistência local real para Vínculos e Erros
**Decisão:** Vínculos e Erros são persistidos em disco (**JSON** via `tauri-plugin-fs`,
em `$APPDATA/nexus-git/`), não apenas em memória de sessão.

**Motivos:** o usuário pode passar muito tempo criando vínculos. Fechar o app não
pode descartar o trabalho. A Wiki é o *output* publicado, não o *backup* local.

> Evolução futura: se o volume crescer, migrar de JSON para **SQLite**
> (`tauri-plugin-sql`). O contrato de dados (seção 5) já é compatível.

### DA-04 — Angular standalone + Signals, Tailwind para estilo
**Decisão:** Angular 18+ com componentes standalone (sem NgModules), estado reativo
com **Signals**, estilização com **Tailwind CSS**.

**Motivos:** app compacto. Angular Material pesaria e engessaria o visual; Tailwind
dá controle fino e um resultado leve e moderno. Signals simplificam o estado
local sem boilerplate de RxJS (RxJS fica só onde fizer sentido).

### DA-05 — Paginação robusta no Rust
**Decisão:** o loop de paginação vive no Rust, usando `per_page=100` e seguindo o
header `Link` (`rel="next"`). Para listas muito grandes, considerar keyset pagination.

**Motivos:** evita o limite default de 20 itens e centraliza a complexidade longe da UI.

---

## 3. Stack tecnológico

| Camada | Tecnologia | Observação |
|---|---|---|
| Shell desktop | **Tauri 2.x** | gera `.exe`/`.msi` Windows, baixo consumo |
| Backend nativo | **Rust** + `reqwest`, `serde`, `keyring`, `tokio` | comandos + HTTP + cofre |
| UI | **Angular 18+** standalone + Signals | sem NgModules |
| Estilo | **Tailwind CSS** | layout limpo e leve |
| HTTP GitLab | `reqwest` (no Rust) | ver DA-01 |
| Token | `keyring` → Windows Credential Manager | ver DA-02 |
| Dados locais | JSON via `tauri-plugin-fs` | ver DA-03 |

---

## 4. Estrutura de pastas (proposta)

```
nexus-git/
├─ ARCHITECTURE.md          # este documento
├─ README.md                # setup e build
├─ package.json             # Angular + scripts
├─ src/                     # frontend Angular
│  ├─ app/
│  │  ├─ core/              # serviços de infra (tauri bridge, store)
│  │  │  ├─ gitlab.service.ts     # wrapper dos invoke()
│  │  │  ├─ storage.service.ts    # persistência local
│  │  │  └─ session.store.ts       # signals globais (token, user)
│  │  ├─ features/
│  │  │  ├─ auth/           # tela de token + config de URL
│  │  │  ├─ sync/           # fetch de issues e branches
│  │  │  ├─ link/           # UI de vínculo (2 colunas)
│  │  │  ├─ errors/         # CRUD de erros
│  │  │  └─ publish/        # geração de Markdown + push Wiki
│  │  ├─ shared/            # componentes (spinner, skeleton, toast)
│  │  └─ models/            # interfaces TS (espelham os structs Rust)
│  └─ styles.css            # Tailwind
└─ src-tauri/               # backend Rust
   ├─ Cargo.toml
   ├─ tauri.conf.json
   └─ src/
      ├─ main.rs
      ├─ commands/
      │  ├─ auth.rs         # validate_token, save/load/delete_token
      │  ├─ issues.rs       # fetch_issues
      │  ├─ branches.rs     # fetch_branches
      │  ├─ wiki.rs         # publish_wiki_page
      │  └─ storage.rs      # load/save links e errors
      ├─ gitlab/            # client HTTP, paginação, modelos
      └─ models.rs
```

---

## 5. Contrato de dados (modelos compartilhados)

Os modelos abaixo existem em ambos os lados (struct Rust ↔ interface TS).

```ts
// Issue (card de requisito)
interface Issue {
  id: number;
  iid: number;            // número visível no GitLab (#123)
  title: string;
  state: 'opened' | 'closed';
  webUrl: string;
  assignee?: string;      // username
  labels: string[];
}

// Branch
interface Branch {
  name: string;
  merged: boolean;
  webUrl: string;
  lastCommitDate?: string;
}

// Vínculo: 1 card -> N branches
interface Link {
  issueIid: number;
  issueTitle: string;
  branchNames: string[];
  createdAt: string;
}

// Erro de desenvolvimento (cadastro manual)
type ErrorStatus = 'Pendente' | 'Falso Positivo' | 'Resolvido';
interface DevError {
  id: string;             // uuid
  description: string;
  branchRef?: string;     // opcional
  status: ErrorStatus;
  createdAt: string;
  updatedAt: string;
}

// Configuração persistida (NÃO inclui o token — esse vai pro keyring)
interface AppConfig {
  gitlabBaseUrl: string;  // ex.: https://gitlab.com ou instância self-hosted
  issuesProjectPath: string;  // ex.: grupo/projeto-de-issues
  codeProjectPath: string;    // ex.: grupo/projeto-de-codigo
}
```

---

## 6. Comandos Tauri (interface Rust ↔ Angular)

| Comando | Entrada | Saída | Descrição |
|---|---|---|---|
| `validate_token` | `{ baseUrl, token }` | `User` ou erro | `GET /user`; valida e retorna dados do usuário |
| `save_token` | `{ token }` | `void` | grava no Credential Manager |
| `load_token` | — | `string?` | lê do Credential Manager |
| `delete_token` | — | `void` | logout |
| `fetch_issues` | `{ assignee?, state? }` | `Issue[]` | com paginação automática |
| `fetch_branches` | — | `Branch[]` | com paginação automática |
| `publish_wiki_page` | `{ slug, title, content }` | `void` | PUT-ou-POST na Wiki |
| `load_state` | — | `{ links, errors }` | lê JSON local |
| `save_state` | `{ links, errors }` | `void` | grava JSON local |
| `load_config` / `save_config` | `AppConfig` | — | URL base e paths dos repos |

**Tratamento de erro padronizado:** os comandos retornam `Result<T, AppError>` onde
`AppError` distingue `Unauthorized` (401), `Forbidden` (403), `NotFound` (404),
`Network` e `Unknown`. A UI reage: 401/403 → volta para a tela de token com mensagem
amigável.

---

## 7. Endpoints GitLab utilizados

Base: `{gitlabBaseUrl}/api/v4`. Auth via header `PRIVATE-TOKEN: {pat}`.
O `:id` do projeto pode ser o ID numérico **ou** o path URL-encoded
(ex.: `grupo%2Fprojeto`).

| Função | Método | Endpoint |
|---|---|---|
| Validar token | `GET` | `/user` |
| Listar issues | `GET` | `/projects/:id/issues?state=opened&assignee_username=&per_page=100` |
| Listar branches | `GET` | `/projects/:id/repository/branches?per_page=100` |
| Criar página Wiki | `POST` | `/projects/:id/wikis` |
| Atualizar página Wiki | `PUT` | `/projects/:id/wikis/:slug` |

**Lógica "criar ou atualizar":** tenta `PUT /wikis/:slug`; se retornar 404, faz
`POST /wikis`. As duas páginas alvo são:
- `Relatorio-Branches-Cards`
- `Relatorio-Status-Erros`

---

## 8. Formato dos relatórios Markdown

### Relatorio-Branches-Cards
```markdown
# Relatório: Branches × Cards
_Gerado em {data} por {usuário}_

| Card | Título | Branches vinculadas |
|------|--------|---------------------|
| [#123](url) | Ajuste no login | `feature/login-fix`, `hotfix/auth` |
```

### Relatorio-Status-Erros
```markdown
# Relatório: Status de Erros
_Gerado em {data}_

## Pendentes
- **Erro:** descrição — _Branch:_ `feature/x`

## Falso Positivo
...

## Resolvidos
...
```

---

## 9. Telas (UX)

1. **Auth/Config** — input do PAT + URL base editável + paths dos repos. Valida e segue.
2. **Sync** — botões "Buscar Issues" / "Buscar Branches", filtro por assignee,
   skeletons durante o fetch.
3. **Vínculo** — duas colunas (Cards | Branches), seleção de 1 card → N branches,
   lista de vínculos já criados.
4. **Erros** — formulário (descrição, branch opcional, status) + tabela editável.
5. **Publicação** — preview dos 2 Markdowns + botão publicar + toast de sucesso/erro.

**Estados de carregamento:** spinners/skeletons obrigatórios em todo fetch
(centenas de branches/issues). Guard de rota: sem token válido → tela de Auth.

---

## 10. Pré-requisitos de ambiente (Windows)

Atualmente instalado: ✅ Node.js + npm. **Falta instalar:**

1. **Rust** — via [rustup](https://rustup.rs/): `rustup-init.exe` (toolchain MSVC).
2. **Microsoft C++ Build Tools** — workload "Desktop development with C++"
   (ou Visual Studio com MSVC). Necessário para compilar Rust no Windows.
3. **WebView2 Runtime** — já vem no Windows 11, mas confirmar.
4. **Tauri CLI** — `npm install -D @tauri-apps/cli` (instalado no projeto na Fase 0).

Verificação rápida após instalar: `rustc --version` e `cargo --version`.

---

## 11. Roadmap de execução

| Fase | Entrega | Status |
|---|---|---|
| **0** | Scaffold Tauri+Angular+Tailwind que abre e roda | ⬜ |
| **1** | Auth: validar/salvar token (keyring) + config de URL | ⬜ |
| **2** | Sync: fetch_issues (filtro+paginação) e fetch_branches | ⬜ |
| **3** | Vínculo (UI 2 colunas) + Erros (CRUD) + persistência | ⬜ |
| **4** | Geração de Markdown + publish na Wiki + feedback | ⬜ |
| **5** | Tratamento global 401/403, build do `.exe`/`.msi` | ⬜ |

---

## 12. Riscos e pontos a confirmar

- [ ] **Project IDs numéricos** dos projetos de issues e de código (ou usar path encoded).
- [ ] **Certificado/CA interna** de instâncias self-hosted — pode exigir
      config no `reqwest` (verificar se TLS valida normalmente).
- [ ] **Permissão de Wiki:** confirmar que o PAT (Maintainer) consegue escrever na Wiki do projeto de código.
- [ ] **Política de rede/proxy** corporativo que possa interceptar as chamadas.
- [ ] Validar nomes exatos dos slugs de Wiki desejados.
```
