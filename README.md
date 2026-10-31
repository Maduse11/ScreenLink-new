# ScreenLink

Protótipo inicial de compartilhamento de tela pelo navegador, com interface em React, sinalização via Socket.IO e transmissão WebRTC.

## O que já está incluído

- Interface escura e responsiva em português.
- Criação de sessão com código numérico temporário de 6 dígitos.
- QR Code para abrir a página de conexão.
- Entrada por código.
- Negociação WebRTC e transmissão de vídeo/áudio quando o navegador permitir.
- Encerramento da sessão e remoção de tracks locais.
- Verificação básica de suporte a `getDisplayMedia()` e contexto seguro.
- Servidor de sinalização com expiração de códigos.

## Requisitos

- Node.js 18 ou superior.
- Navegador moderno.
- HTTPS em produção. `localhost` é aceito para desenvolvimento.

## Instalação

```bash
npm install
npm run dev
```

Abra:
- Front-end: http://localhost:5173
- Servidor de sinalização: http://localhost:3001/api/health

Para testar entre dois dispositivos na rede, o endereço precisa estar acessível pelo outro aparelho e usar HTTPS para a captura de tela. O endereço `localhost` só funciona no próprio dispositivo.

## Build de produção

```bash
npm run build
NODE_ENV=production npm start
```

Configure `CLIENT_ORIGIN` com a origem pública do site e `VITE_SIGNALING_URL` com a URL pública do servidor de sinalização antes do build, se front-end e servidor estiverem em domínios diferentes.

## Limitações importantes

- A captura de tela depende da API `navigator.mediaDevices.getDisplayMedia()` e do suporte do navegador/sistema. Muitos navegadores móveis, especialmente Android, não oferecem essa API para sites. O site detecta a ausência e informa a limitação.
- O compartilhamento de áudio do sistema não é garantido. O navegador pode ignorar a opção de áudio ou não disponibilizá-la.
- O projeto não controla remotamente o celular.
- O servidor de sinalização não grava mídia. Porém, a mídia pode ser retransmitida por um servidor TURN em redes que exijam isso; este protótipo usa STUN público e pode não conectar em todas as redes.
- O código de seis dígitos é uma conveniência de pareamento, não substitui autenticação forte. Antes de uso público, adicione rate limiting, proteção contra abuso, validação de origem, monitoramento e testes de segurança.
- Use HTTPS e WSS em produção. Não exponha o servidor sem configurar domínio, TLS e políticas de segurança.

## Próximos passos recomendados

1. Configurar HTTPS e domínio.
2. Adicionar TURN próprio para melhorar a conectividade entre redes.
3. Implementar limites de tentativas por IP e por sessão.
4. Testar navegadores e aparelhos reais.
5. Revisar acessibilidade e segurança antes de divulgar o serviço.
