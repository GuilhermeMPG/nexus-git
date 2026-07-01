# Nexus-Git

Aplicativo desktop (Tauri + Angular + Rust) para rastreabilidade entre **Issues** e
**Branches** no GitLab, gestão de erros de desenvolvimento e publicação automática de
relatórios na **Wiki** — com suporte a múltiplos projetos de código/wiki simultâneos.

Veja [ARCHITECTURE.md](./ARCHITECTURE.md) para detalhes de arquitetura e decisões de design.

## Stack

- **Tauri 2.x** + **Angular 20** (standalone components, Signals) + **Rust** (`reqwest`, `keyring`)
- Ícones via `@lucide/angular`
- O token (PAT) do GitLab nunca sai do processo Rust — fica no Windows Credential Manager
- Config e estado local em `%APPDATA%\nexus-git\` (`config.json`, `state.json`, escrita atômica)

## Funcionalidades

- Multi-projeto: cada projeto tem seu repositório de código e destino de Wiki (próprio ou
  centralizado, via prefixo de slug)
- Sync: issues (paginado, filtro por assignee/estado/labels), branches, MRs, milestones
- Vínculos e Erros: merge *last-write-wins* com a Wiki, preview de conflito antes de
  importar/publicar, import/export CSV
- Publicação automática em segundo plano (intervalo configurável)
- Dashboard com cobertura agregada de todos os projetos habilitados
- Atalhos de teclado (`Esc` fecha modais, `/` foca o filtro principal de cada tela)

## Desenvolvimento

Rodar o app em modo desenvolvimento (Angular + Rust com hot-reload):

```bash
npx tauri dev
```

Só o frontend (sem a janela nativa — não funciona login/Wiki, que dependem do backend Rust):

```bash
npm start
```

## Testes

```bash
npm test
```

## Build de produção

**Portátil (`.exe` único, sem instalador)** — recomendado para distribuir rapidamente:

```bash
npm run portable
```

Gera `portable/Nexus-Git-vN.exe`, incrementando `N` automaticamente a cada execução (não
sobrescreve builds anteriores). Internamente roda `tauri build --no-bundle`, que compila o
frontend em modo produção e o binário Rust em release, sem depender de NSIS/WiX.

> Requer o **WebView2 Runtime** na máquina onde for executado (já vem por padrão no
> Windows 10 21H2+/Windows 11).
>
> Configurações e token ficam em `%APPDATA%\nexus-git\` e no Credential Manager do Windows —
> específicos de cada máquina/usuário, não viajam junto com o `.exe`.

**Instaladores (`.msi`/NSIS)** — requer NSIS ou WiX Toolset instalados:

```bash
npx tauri build
```

Os artefatos ficam em `src-tauri/target/release/bundle/`.

## Estrutura

```
src/app/
  core/       serviços singleton (config, estado, sync, auto-publish, notificações)
  features/   uma pasta por tela (sync, link, errors, dashboard, publish, config, shell)
  models/     tipos compartilhados TS
src-tauri/
  src/commands/   comandos Tauri (auth, storage, sync)
  src/gitlab/     cliente HTTP do GitLab
scripts/
  build-portable.js   gera o .exe portátil versionado
```
