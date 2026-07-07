## Novidades

- **Corrigido:** login em instâncias GitLab internas (intranet, certificado de CA própria)
  falhava com um erro de rede genérico, sem solução visível — a opção de ignorar verificação
  de certificado só existia em Configurações, que só é alcançável depois de logar.
- A tela de login agora tem essa opção diretamente ("Ignorar verificação de certificado TLS"),
  e o erro de rede passou a explicar isso e apontar pra ela em vez de mostrar o texto técnico cru.
