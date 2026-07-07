# Patron: guia para o Advogado

**Passo a passo, do primeiro acesso ate a peca pronta.**
Corresponde ao instalador de julho de 2026. Nao e preciso nenhum preparo tecnico. Se sabe trabalhar com documentos no Word, sabe usar o Patron.

---

## Sumario

1. [O que e o Patron (em um paragrafo)](#1-o-que-e-o-patron)
2. [Primeiro acesso](#2-primeiro-acesso)
3. [Mapa da tela: tres paineis](#3-mapa-da-tela)
4. [Passo 1: criar o processo e enviar os arquivos](#4-passo-1-criar-o-processo-e-enviar-os-arquivos)
5. [Passo 2: o chat com os autos do processo](#5-passo-2-o-chat-com-os-autos)
6. [Passo 3: legislacao e processos judiciais](#6-passo-3-legislacao-e-processos)
7. [Passo 4: trabalhar nos documentos e EDITA-LOS](#7-passo-4-editar-documentos)
8. [Passo 5: uma tabela a partir de varios contratos (Revisao tabular)](#8-passo-5-uma-tabela-a-partir-de-contratos)
9. [Passo 6: os workflows (tarefas repetiveis)](#9-passo-6-os-workflows)
10. [Passo 7: escolher o modelo de IA](#10-passo-7-escolher-o-modelo)
11. [Biblioteca de habilidades](#11-biblioteca-de-habilidades)
12. [Perguntas frequentes e problemas](#12-perguntas-frequentes)
13. [Lembrete: prompts prontos](#13-lembrete-prompts-prontos)

---

## 1. O que e o Patron

O Patron e o seu assistente juridico instalado **no seu computador** (um aplicativo desktop, como o Word). Voce envia os autos do processo (contratos, peticoes, decisoes, digitalizacoes) e o Patron:

- **le tudo para voce** e responde as suas perguntas, citando as fontes dos seus proprios documentos,
- **pesquisa legislacao** (direito brasileiro federal) e **metadados processuais** (DataJud/CNJ) em um conjunto de bases de dados integradas,
- **propoe alteracoes nos documentos** em forma de revisoes (o controle de alteracoes do Word), que voce aceita com um clique,
- **aprimora as suas pecas** (revisor, advogado do diabo, editor de linguagem).

O Patron nao toma decisoes juridicas nem substitui o seu julgamento. E uma ferramenta: uma leitura mais rapida do processo e uma primeira minuta que voce sempre revisa.

---

## 2. Primeiro acesso

1. Abra o **PATRON** (icone na area de trabalho ou menu Iniciar). Vera uma tela de carregamento e, depois de uns dez segundos, a janela principal. Nao e preciso conta nem login. O Patron e local e single-user, entao os autos do processo, as bases de dados e o historico de conversas ficam no seu computador.
2. **Adicione a chave de um modelo de IA.** E o unico passo sem o qual o assistente nao responde. Abra **Conta -> Modelos e chaves de API** e cole a chave do seu provedor (por exemplo Libra/Anthropic, ou Gemini/OpenAI). Salve. A partir dai o chat, a edicao de documentos e as tabelas funcionam. Detalhes: [Passo 7](#10-passo-7-escolher-o-modelo).
3. **Internet e conversao de arquivos.** Um modelo em nuvem e a busca ao vivo de legislacao e processos (legis.senado.leg.br, normas.leg.br, DataJud CNJ) exigem conexao com a internet. A busca nos seus proprios documentos funciona mesmo offline. Se ao enviar arquivos `.doc` antigos aparecer um erro de conversao, peca ao administrador para instalar o LibreOffice (e gratuito).

> **Dica:** o Patron se dirige a voce como "Doutor(a)". Ele fala em portugues e redige as pecas em portugues, porque se destinam a tribunais brasileiros. Nao sabe por onde comecar? Pergunte diretamente no chat: **"O que voce sabe fazer?"** ou **"Por onde eu comeco?"**, e ele vai apresentar as funcoes passo a passo. Se nao estiver vendo algo, expanda o painel esquerdo (**Explorador**).

---

## 3. Mapa da tela

A tela do assistente esta dividida em **tres paineis verticais**:

| Painel | Nome | Para que serve |
|---|---|---|
| **esquerdo** | **Explorador** | a lista de processos (projetos) e documentos; e aqui que voce envia os arquivos |
| **central** | **Visualizacao do documento** | o conteudo do documento em que voce clicou; e aqui que aparecem as revisoes |
| **direito** | **Assistente** | o chat, onde voce faz perguntas e da instrucoes |

Voce pode recolher o painel esquerdo ("Recolher o explorador") e expandi-lo de novo quando precisar de espaco para a visualizacao.

---

## 4. Passo 1: criar o processo e enviar os arquivos

**Regra 1: um processo = um projeto.** Nao misture arquivos de causas diferentes. Para cada pergunta que voce fizer, o Patron busca em todos os documentos do projeto.

### 4.1. Criar um projeto
1. No painel esquerdo, clique em **Novo projeto** (ou "Novo processo", atalho **Ctrl+N**).
2. De um nome claro, por exemplo `Silva x Construtora ACME, processo 2026`.

### 4.2. Enviar os documentos: tres formas

- **Arrastar e soltar:** selecione os arquivos ou a pasta no Explorador de Arquivos do Windows e solte no painel (vai aparecer "Solte para enviar").
- **Enviar documentos:** o botao no painel esquerdo, depois escolha os arquivos (PDF, DOCX, DOC).
- **Importar pasta do processo** (a opcao mais rapida com muitos arquivos): informe o caminho da pasta, por exemplo `C:\Processos\Silva-2026`. O Patron importa todos os arquivos de uma vez, faz a varredura de seguranca e os indexa.

O que acontece nos bastidores (voce nao precisa fazer nada): o Patron reconhece a estrutura redacional do documento (artigos, incisos, paragrafos), roda o OCR nas digitalizacoes e o texto completo entra na busca. Funcionam tambem digitalizacoes em papel e arquivos sem camada de texto.

> **Regra 2: envie TODOS os autos do processo antes da primeira pergunta.** Quanto mais completo o processo, mais precisas as respostas. Documentos adicionados depois nao mudam retroativamente as respostas anteriores.

---

## 5. Passo 2: o chat com os autos

No painel direito (**Assistente**), escreva a sua pergunta e envie. O Patron seleciona sozinho os trechos mais relevantes de todo o processo (voce nao precisa colar nenhum texto).

**Faca perguntas especificas.** Em vez de "o que tem no contrato", escreva:
- "Quais obrigacoes a contratada tem segundo a clausula 5 do contrato 3?"
- "Liste todos os prazos de pagamento e multas contratuais deste contrato."
- "Ha fundamento para prescricao? Aponte as datas no processo."
- "Quais incoerencias existem entre o contrato principal e o anexo 2?"

### Observe o selo colorido ao lado das citacoes
Toda citacao tirada dos seus documentos recebe um indicador de confiabilidade:

- verde: **citacao literal**, encontrada nos autos do seu processo. Pode usar em uma peca indicando a fonte.
- amarelo: **possivel reformulacao ou paráfrase**. Compare com o original.
- vermelho: **nao encontrada no processo**. **Nao cite sem verificacao manual.** Pode ser uma frase que so parece uma citacao.

> **Regra 3: antes de colar uma citacao em uma peca, olhe o selo.** E o seu filtro contra alucinacoes.

---

## 6. Passo 3: legislacao e processos

A edicao brasileira do Patron vem com o **conector do direito brasileiro integrado** (funciona logo apos a instalacao, sem configuracao):

| Base de dados | O que voce encontra |
|---|---|
| **legis.senado.leg.br / normas.leg.br** | legislacao federal brasileira: identificacao, procedencia no Diario Oficial da Uniao, historico de alteracoes por artigo, e o texto real do artigo (URN Lex) |
| **DataJud (CNJ)** | metadados processuais - numero do processo, classe, orgao julgador, assuntos e a linha do tempo de movimentos (nao o inteiro teor da decisao) |

Os demais conectores NAO vem no instalador - a edicao continua enxuta. O direito da UE (**EUR-Lex**, o pacote de conformidade **EU-Compliance** offline: GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) e os conectores de outras jurisdicoes (inclusive os polacos: SAOS, NSA, ISAP, KRS) sao baixados separadamente na **MateMatic Boutique** (matematicsolutions.com/boutique) e conectados ao aplicativo. Depois de instalados, voce os ativa em **Conta -> Conectores** ("Conectores de direito").

Pergunte em linguagem natural e o Patron escolhe sozinho a base certa:

- "Mostre o art. 186 do Codigo Civil vigente."
- "Qual o historico de alteracoes do art. 5 da LGPD?"
- "Consulte o processo REsp 1.234.567 no DataJud - numero, classe e orgao julgador."
- Com o conector EU-Compliance instalado pela Boutique: "Qual e a definicao de sistema de IA de alto risco no AI Act?"

> **Lembre-se:** o DataJud traz metadados processuais (numero, classe, movimentos), NAO o inteiro teor de acordaos ou ementas, e nao cobre o STF. Para jurisprudencia em texto integral, o Patron vai indicar as bases oficiais (scon.stj.jus.br, portal.stf.jus.br/jurisprudencia) em vez de inventar uma ementa. Antes de citar uma norma em uma peca, verifique o texto vigente na fonte oficial, porque a legislacao muda.

---

## 7. Passo 4: editar documentos

Este e o centro do trabalho diario. O Patron edita documentos de tres formas. Todas terminam em um arquivo que voce abre no Word.

### 7A. Pedir uma alteracao, revisar as sugestoes, aceitar

E o jeito mais pratico para correcoes pontuais em um contrato ou peca.

1. No Explorador, **clique em um documento DOCX**. Ele aparece no painel central (**Visualizacao do documento**).
2. No Assistente, escreva o que voce quer, **indicando o ponto**:
   - "Proponha uma alteracao na clausula 4. Quero limitar a responsabilidade da contratada aos danos emergentes, excluindo lucros cessantes."
   - "Adicione na clausula 3 uma clausula de eleicao de foro na comarca da sede da contratante."
   - "Reformule a clausula 7 para que o prazo de aviso previo seja de 3 meses, com efeito a partir do fim do mes."
3. O Patron responde com **cartoes de alteracao**. Cada cartao mostra:
   - o texto **adicionado** em verde,
   - o texto **removido** em vermelho, riscado,
   - uma breve **justificativa** da alteracao.
4. Cada cartao oferece tres botoes:
   - **Aceitar:** o Patron aplica a alteracao e cria uma **nova versao** do documento (revisoes reais do Word),
   - **Rejeitar:** a alteracao desaparece,
   - **Abrir:** pre-visualizacao da alteracao no contexto do documento inteiro.
5. Depois de aceitar, baixe o arquivo final (icone de download ao lado do documento) e abra no Word. Voce vera as alteracoes como uma revisao aguardando aceitacao final.

> Voce pode aceitar as alteracoes uma a uma ou em bloco. Cada aceitacao salva uma nova versao e as versoes anteriores ficam no historico, entao nada se perde.

### 7B. Aprimorar uma peca inteira: "Minuta de resposta" (revisor, advogado do diabo, linguagem)

E o modo para uma peca inteira, ou para um trecho mais longo que voce quer reforcar.

1. Abra o painel **Minuta de resposta** (o icone ao lado da resposta do assistente, ou pelo menu).
2. No campo **Texto da peca**, cole o seu texto de trabalho.
3. Escolha a perspectiva do advogado do diabo (**"a partir de qual perspectiva"**):
   - **Parte contraria:** como o advogado da outra parte vai atacar,
   - **O tribunal:** sobre o que o colegiado vai questionar,
   - **Ministerio Publico:** o angulo da acusacao.
4. Clique em **Aprimorar a peca**. O Patron passa o texto por tres etapas:
   - **Revisor:** aponta lacunas logicas e referencias fracas, e reforca a argumentacao,
   - **Advogado do diabo:** antecipa e rebate os contra-argumentos a partir da perspectiva escolhida,
   - **Escrever com clareza:** remove o "estilo de IA" mantendo a precisao juridica.
5. Voce recebe uma **Minuta pronta** (que pode copiar) e uma secao expansivel **"Como a minuta foi construida"** que mostra o que cada etapa mudou.

> **Regra 4: o pipeline rende melhor sobre um texto ja pronto, nao sobre um prompt vazio.** Escreva a sua versao, cole e peca para reforca-la. Depois adicione a sua revisao e, se precisar, uma segunda passada.

### 7C. Ida e volta: editar no Word, voltar ao Patron

Se preferir trabalhar no Word:

1. Baixe o documento do Patron.
2. No Word, faca **as suas alteracoes com o controle de alteracoes ativo**, adicione comentarios e, sempre que quiser que o Patron faca algo, escreva uma instrucao em um comentario no formato `[PATRON: escreva aqui a instrucao]`.
3. Envie o arquivo de novo (como nova versao). O Patron le as suas alteracoes, os comentarios e as instrucoes `[PATRON: ...]`, e aprende o seu estilo de edicao.

### 7D. Versoes e download
- Cada alteracao aceita = uma nova versao (o historico e mantido).
- Baixe um arquivo individual pelo icone de download, ou o projeto inteiro como ZIP.

---

## 8. Passo 5: uma tabela a partir de contratos

Quando voce tem **muitos documentos parecidos** (por exemplo 30 contratos de locacao) e quer compara-los em uma tabela, use a **Revisao tabular**.

1. Va em **Revisoes tabulares -> + Criar nova**.
2. Adicione colunas, a partir de modelos juridicos prontos (Partes, Objeto, Multa contratual, Lei aplicavel, Prazo de aviso previo...) ou suas proprias, por exemplo "Clausula de protecao de dados: sim/nao".
3. Clique em **Gerar**. A tabela vai se preenchendo em tempo real: o Patron busca em cada documento e insere o resultado.
4. Cada celula tem um selo de confiabilidade (verde/amarelo/vermelho). Vermelho significa verificacao manual; clique na celula para ver a fonte.
5. Exporte para Excel para o cliente ou para a equipe.

> O ponto central: analisa uma serie de contratos em uma unica passada em vez de abri-los um a um, e cada celula remete a sua fonte.

---

## 9. Passo 6: os workflows

Salve uma vez uma tarefa repetivel (por exemplo "Analise de locacoes", "Revisao de due diligence") como **workflow** e execute em novos processos com um clique.

- Comece pelos workflows integrados.
- Os seus: **Workflows -> Adicionar workflow**, escreva as instrucoes passo a passo e salve.
- Voce pode compartilhar um workflow com colegas, para que todo o escritorio conduza a due diligence pelo mesmo checklist.

---

## 10. Passo 7: escolher o modelo

O Patron e **neutro em relacao a fornecedores**, entao o modelo e escolhido por voce. E uma unica configuracao em **Conta -> Modelos e chaves de API**, e muda-la nao exige reinstalacao.

- **Um modelo em nuvem (por exemplo Libra / Claude, Gemini)** oferece a melhor qualidade de redacao e raciocinio. E a escolha normal de trabalho para um escritorio. O conteudo da sua solicitacao vai entao para o provedor escolhido.
- **Um modelo local (Ollama)** funciona sem internet, sem custo por uso. Exige uma instalacao unica do Ollama e o download do modelo no seu computador.

Voce pode combinar os dois: um modelo mais barato ou local para explorar o processo, um mais forte para a peca final. Consumo e custos sao controlados em **Conta -> Consumo** (com filtro por processo).

**Sigilo profissional e a nuvem.** Na versao desktop, voce, advogado na sua propria maquina, e quem hospeda os dados, entao a sua escolha de um modelo em nuvem e um consentimento informado. O Patron permite trabalhar com qualquer modelo, mesmo em processos marcados como confidenciais. **Todo** fluxo de dados para o modelo e registrado em um log de auditoria imutavel (evidencia de diligencia, AI Act art. 12), e dados pessoais sao mascarados antes do envio. Se o escritorio quiser um regime mais rigoroso (por exemplo, processos confidenciais somente em modelo local), o administrador pode configurar isso. Por padrao, nada bloqueia o seu uso.

---

## 11. Biblioteca de habilidades

A **Biblioteca de habilidades** e um conjunto de "habilidades" que o Patron aplica ao aprimorar pecas:

- **Integradas** (sempre ativas): **Revisor**, **Advogado do diabo**, **Escrever com clareza**.
- **Instaladas** (suas): voce pode ativar, desativar e importar etapas adicionais de um arquivo.

As integradas nao exigem nenhuma configuracao. Elas trabalham no painel "Minuta de resposta".

---

## 12. Perguntas frequentes

**O assistente nao responde, ou o chat retorna um erro (especialmente logo apos a instalacao).**
A causa mais comum e a falta da chave do modelo. Abra **Conta -> Modelos e chaves de API** e adicione uma chave (por exemplo Libra/Anthropic). A segunda causa e a falta de internet com um modelo em nuvem. Verifique tambem em **Conta -> Modelos e chaves de API** se o modelo selecionado e um dos que voce tem chave.

**Os autos do meu processo vao para a nuvem?**
So se voce escolheu um modelo em nuvem; nesse caso o conteudo da sua solicitacao vai para aquele provedor. Com um modelo local, tudo fica no seu computador. Os arquivos, as bases de dados e o historico de conversas ficam sempre armazenados localmente.

**O Patron escreveu algo que nao esta no processo.**
Olhe o selo: vermelho significa nao verificado. Modelos podem "preencher lacunas". O selo e a sua propria verificacao sao o filtro final, e o Patron nao os substitui.

**A conversao DOCX/PDF nao funciona.**
A conversao de documentos exige o LibreOffice no computador. Se algo estiver faltando, avise o administrador do escritorio.

**Como eu exporto para o Word uma peca com comentarios?**
Peca as alteracoes como revisoes (Passo 4A), aceite as que quiser e baixe o DOCX. No Word voce vera uma revisao aguardando aceitacao final.

**O Patron verifica se uma norma esta vigente?**
As bases de dados oferecem acesso rapido ao texto, mas podem estar atrasadas em relacao ao Diario Oficial. Verifique o texto vigente na fonte oficial antes de redigir.

**O Patron toma decisoes juridicas?**
Nao. A avaliacao juridica, a assinatura e a responsabilidade profissional sao suas.

---

## 13. Lembrete: prompts prontos

**Chat com os autos do processo**
- "Liste todos os prazos e multas contratuais deste contrato."
- "Quais incoerencias existem entre o documento A e o documento B?"
- "Ha risco de prescricao? Aponte as datas no processo."

**Legislacao e processos**
- "Mostre o art. [X] do [codigo] vigente."
- "Qual o historico de alteracoes do art. [X] da [lei]?"
- "Consulte o processo [numero] no DataJud."
- Com os conectores polacos ativados: "Verifique [nome da empresa] no KRS."

**Editar um documento (depois de clicar em um arquivo DOCX)**
- "Proponha uma alteracao na clausula [X]: [o que voce quer], como revisao."
- "Adicione na clausula [X] uma clausula [descricao]."
- "Reformule a clausula [X]: [novo texto ou objetivo]."

**Aprimorar uma peca**
- O painel "Minuta de resposta": cole o texto, escolha a perspectiva, depois "Aprimorar a peca".

---

*O Patron e uma ferramenta de apoio ao trabalho do advogado. Toda peca e revisada e assinada pelo Advogado antes do envio. Este documento reflete o estado do aplicativo em julho de 2026.*
