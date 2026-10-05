# Hessel Domiciliar · Fechamento de folhas e produtividade

Sistema web para o fechamento mensal das folhas de atendimento domiciliar:
cadastros, planilha de atendimento, conferência das folhas salvas na pasta e documentos em papel timbrado.

## Telas

**Sistema (`/app`)** — operador e administrador
- **Painel**: pacientes e profissionais ativos, atendimentos lançados, folhas recebidas × faltando, histórico dos meses.
- **Planilha de atendimento**: uma linha por *paciente + profissional* e uma coluna por dia do mês (fins de semana destacados).
  Cada dia aceita a quantidade de atendimentos (`1`, `2`…), `X` (= 1) ou códigos que não somam (`F` falta, `FE` férias, `A` afastado).
  Salva sozinha, tem totais por linha e por dia, navegação pelo teclado, "copiar do mês anterior" e exportação para **Excel** e **PDF timbrado**.
- **Conferência de folhas**: escolha a pasta onde as folhas foram salvas (ou arraste os arquivos, ou cole a lista de nomes).
  O sistema lê **só os nomes** (os arquivos não saem do computador) e compara com o padrão
  `Paciente NOME DO PACIENTE - Profissional NOME DO PROFISSIONAL.pdf`, com os cadastros e com a planilha do mês:
  - correto · grafia diferente (acentos, maiúsculas, erro de digitação, nome abreviado) · fora do padrão
    (ainda assim tenta achar os nomes) · não cadastrado · duplicado · dupla fora da planilha;
  - **Folhas que faltam subir**, com botão *Copiar nome* para salvar o anexo do e-mail já no padrão;
  - nome sugerido para cada arquivo errado e um **script `.bat`** que renomeia tudo de uma vez (copiar para a pasta e dar dois cliques);
  - o resultado fica registrado; também dá para marcar uma folha como recebida manualmente.
- **Pacientes** e **Profissionais (prestadores)**: cadastro, busca, inativação (o histórico é mantido),
  **importação da planilha do Excel** (reconhece colunas como NOME, CPF, TELEFONE, CATEGORIA/FUNÇÃO, COREN/REGISTRO, CONVÊNIO…)
  e exportação para Excel e PDF timbrado.
- **Documentos e timbrado**: papel timbrado em branco (retrato/paisagem) e documentos (declaração, comunicado, ofício,
  recibo ou texto livre) gerados em PDF no timbrado, salvos para reaproveitar.

**Administração (`/admin`)** — só administrador
- **Usuários**: criar, definir perfil (administrador/operador), bloquear e redefinir senha.
- **Empresa e timbrado**: logo (PNG/JPG), nome, CNPJ, telefone, e-mail, site, endereço e rodapé usados em todos os PDFs;
  categorias de profissionais.
- **Auditoria**: quem fez o quê e quando (com exportação para Excel).
- **Sistema e backup**: números gerais, histórico de conferências, **backup do banco** e exclusão de uma competência.

## Como rodar

Requisito: **Node.js 22.13+** (usa o SQLite nativo do Node, sem banco externo).

```bash
npm install
npm run seed      # opcional: dados de demonstração
npm start         # http://localhost:3000
npm test
```

Primeiro acesso: usuário **`admin`**, senha **`hessel-admin`** (o painel avisa até que seja trocada).

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_LOGIN` / `ADMIN_PASSWORD` | Administrador criado no primeiro início | `admin` / `hessel-admin` (obrigatório definir em produção) |
| `PORT` | Porta HTTP | `3000` |
| `DATA_DIR` | Pasta do banco (`hessel.db`) e do logo enviado | `./data` |
| `SESSION_SECRET` | Chave dos cookies de sessão | gerada e salva em `data/` |
| `NODE_ENV=production` | Cookies só via HTTPS | – |

## Publicação

- **Render**: em render.com → *New → Blueprint* → este repositório (o `render.yaml` já cria o serviço com disco permanente);
  informe `ADMIN_PASSWORD` quando pedir.
- **Docker**: `docker build -t hessel . && docker run -d -p 3000:3000 -v hessel-dados:/data -e ADMIN_PASSWORD=... hessel`
  (com um proxy HTTPS na frente).

## Estrutura

```
server.js      API (login, cadastros, planilha, folhas, documentos, admin) + arquivos estáticos
db.js          esquema SQLite e senhas (scrypt)
pdf.js         papel timbrado, documentos e tabelas em PDF (pdf-lib)
public/        telas em HTML/CSS/JS puro; js/conferencia.js faz a conferência dos nomes
test/          testes (node --test)
```
