# Patron: guia para o Advogado

**Passo a passo, do primeiro acesso ate a peça pronta.**
Corresponde ao instalador de julho de 2026. Não e preciso nenhum preparo técnico. Se sabe trabalhar com documentos no Word, sabe usar o Patron.

---

## Sumario

1. [O que e o Patron (em um parágrafo)](#1-o-que-e-o-patron)
2. [Primeiro acesso](#2-primeiro-acesso)
3. [Mapa da tela: três painéis](#3-mapa-da-tela)
4. [Passo 1: criar o processo e enviar os arquivos](#4-passo-1-criar-o-processo-e-enviar-os-arquivos)
5. [Passo 2: o chat com os autos do processo](#5-passo-2-o-chat-com-os-autos)
6. [Passo 3: legislação e processos judiciais](#6-passo-3-legislação-e-processos)
7. [Passo 4: trabalhar nos documentos e EDITÁ-LOS](#7-passo-4-editar-documentos)
8. [Passo 5: uma tabela a partir de varios contratos (Revisão tabular)](#8-passo-5-uma-tabela-a-partir-de-contratos)
9. [Passo 6: os workflows (tarefas repetiveis)](#9-passo-6-os-workflows)
10. [Passo 7: escolher o modelo de IA](#10-passo-7-escolher-o-modelo)
11. [Biblioteca de habilidades](#11-biblioteca-de-habilidades)
12. [Perguntas frequentes e problemas](#12-perguntas-frequentes)
13. [Lembrete: prompts prontos](#13-lembrete-prompts-prontos)

---

## 1. O que e o Patron

O Patron e o seu assistente jurídico instalado **no seu computador** (um aplicativo desktop, como o Word). Você envia os autos do processo (contratos, petições, decisões, digitalizações) e o Patron:

- **le tudo para você** e responde as suas perguntas, citando as fontes dos seus próprios documentos,
- **pesquisa legislação** (direito brasileiro federal) e **metadados processuais** (DataJud/CNJ) em um conjunto de bases de dados integradas,
- **propoe alterações nos documentos** em forma de revisões (o controle de alterações do Word), que você aceita com um clique,
- **aprimora as suas peças** (revisor, advogado do diabo, editor de linguagem).

O Patron não toma decisões jurídicas nem substitui o seu julgamento. E uma ferramenta: uma leitura mais rápida do processo e uma primeira minuta que você sempre revisa.

---

## 2. Primeiro acesso

1. Abra o **PATRON** (icone na área de trabalho ou menu Iniciar). Vera uma tela de carregamento e, depois de uns dez segundos, a janela principal. Não e preciso conta nem login. O Patron e local e single-user, então os autos do processo, as bases de dados e o histórico de conversas ficam no seu computador.
2. **Adicione a chave de um modelo de IA.** E o único passo sem o qual o assistente não responde. Abra **Conta -> Modelos e chaves de API** e cole a chave do seu provedor (por exemplo Libra/Anthropic, ou Gemini/OpenAI). Salve. A partir dai o chat, a edição de documentos e as tabelas funcionam. Detalhes: [Passo 7](#10-passo-7-escolher-o-modelo).
3. **Internet e conversão de arquivos.** Um modelo em nuvem e a busca ao vivo de legislação e processos (legis.senado.leg.br, normas.leg.br, DataJud CNJ) exigem conexão com a internet. A busca nos seus próprios documentos funciona mesmo offline. Se ao enviar arquivos `.doc` antigos aparecer um erro de conversão, peça ao administrador para instalar o LibreOffice (e gratuito).

> **Dica:** o Patron se dirige a você como "Doutor(a)". Ele fala em português e redige as peças em português, porque se destinam a tribunais brasileiros. Não sabe por onde comecar? Pergunte diretamente no chat: **"O que você sabe fazer?"** ou **"Por onde eu começo?"**, e ele vai apresentar as funções passo a passo. Se não estiver vendo algo, expanda o painel esquerdo (**Explorador**).

---

## 3. Mapa da tela

A tela do assistente esta dividida em **três painéis verticais**:

| Painel | Nome | Para que serve |
|---|---|---|
| **esquerdo** | **Explorador** | a lista de processos (projetos) e documentos; e aqui que você envia os arquivos |
| **central** | **Visualização do documento** | o conteúdo do documento em que você clicou; e aqui que aparecem as revisões |
| **direito** | **Assistente** | o chat, onde você faz perguntas e da instruções |

Você pode recolher o painel esquerdo ("Recolher o explorador") e expandi-lo de novo quando precisar de espaco para a visualização.

---

## 4. Passo 1: criar o processo e enviar os arquivos

**Regra 1: um processo = um projeto.** Não misture arquivos de causas diferentes. Para cada pergunta que você fizer, o Patron busca em todos os documentos do projeto.

### 4.1. Criar um projeto
1. No painel esquerdo, clique em **Novo projeto** (ou "Novo processo", atalho **Ctrl+N**).
2. De um nome claro, por exemplo `Silva x Construtora ACME, processo 2026`, e preencha a **Referência** - ela aparece depois como coluna própria na lista de casos.

### 4.2. Enviar os documentos: três formas

- **Arrastar e soltar:** selecione os arquivos ou a pasta no Explorador de Arquivos do Windows e solte no painel (vai aparecer "Solte para enviar").
- **Enviar documentos:** o botao no painel esquerdo, depois escolha os arquivos (PDF, DOCX, DOC).
- **Importar pasta do processo** (a opção mais rápida com muitos arquivos): informe o caminho da pasta, por exemplo `C:\Processos\Silva-2026`. O Patron importa todos os arquivos de uma vez, faz a varredura de segurança e os indexa.

O que acontece nos bastidores (você não precisa fazer nada): o Patron reconhece a estrutura redacional do documento (artigos, incisos, parágrafos), roda o OCR nas digitalizações e o texto completo entra na busca. Funcionam também digitalizações em papel e arquivos sem camada de texto.

> **Regra 2: envie TODOS os autos do processo antes da primeira pergunta.** Quanto mais completo o processo, mais precisas as respostas. Documentos adicionados depois não mudam retroativamente as respostas anteriores.

---

## 5. Passo 2: o chat com os autos

No painel direito (**Assistente**), escreva a sua pergunta e envie. O Patron seleciona sozinho os trechos mais relevantes de todo o processo (você não precisa colar nenhum texto).

**Faça perguntas especificas.** Em vez de "o que tem no contrato", escreva:
- "Quais obrigações a contratada tem segundo a cláusula 5 do contrato 3?"
- "Liste todos os prazos de pagamento e multas contratuais deste contrato."
- "Ha fundamento para prescrição? Aponte as datas no processo."
- "Quais incoerencias existem entre o contrato principal e o anexo 2?"

### Observe o selo colorido ao lado das citações
Toda citação tirada dos seus documentos recebe um indicador de confiabilidade:

- verde: **citação literal**, encontrada nos autos do seu processo. Pode usar em uma peça indicando a fonte.
- amarelo: **possível reformulação ou paráfrase**. Compare com o original.
- vermelho: **não encontrada no processo**. **Não cite sem verificação manual.** Pode ser uma frase que so parece uma citação.

> **Regra 3: antes de colar uma citação em uma peça, olhe o selo.** E o seu filtro contra alucinações.

---

## 6. Passo 3: legislação e processos

A edição brasileira do Patron vem com o **conector do direito brasileiro integrado** (funciona logo após a instalação, sem configuração):

| Base de dados | O que você encontra |
|---|---|
| **legis.senado.leg.br / normas.leg.br** | legislação federal brasileira: identificação, procedência no Diario Oficial da Uniao, histórico de alterações por artigo, e o texto real do artigo (URN Lex) |
| **DataJud (CNJ)** | metadados processuais - número do processo, classe, órgão julgador, assuntos e a linha do tempo de movimentos (não o inteiro teor da decisão) |

Os demais conectores NÃO vem no instalador - a edição continua enxuta. O direito da UE (**EUR-Lex**, o pacote de conformidade **EU-Compliance** offline: GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) e os conectores de outras jurisdições (inclusive os polacos: SAOS, NSA, ISAP, KRS) são baixados separadamente na **MateMatic Boutique** (matematicsolutions.com/boutique) e conectados ao aplicativo. Depois de instalados, você os ativa em **Conta -> Conectores** ("Conectores de direito").

Pergunte em linguagem natural e o Patron escolhe sozinho a base certa:

- "Mostre o art. 186 do Código Civil vigente."
- "Qual o histórico de alterações do art. 5 da LGPD?"
- "Consulte o processo REsp 1.234.567 no DataJud - número, classe e órgão julgador."
- Com o conector EU-Compliance instalado pela Boutique: "Qual e a definição de sistema de IA de alto risco no AI Act?"

> **Lembre-se:** o DataJud traz metadados processuais (número, classe, movimentos), NÃO o inteiro teor de acordaos ou ementas, e não cobre o STF. Para jurisprudência em texto integral, o Patron vai indicar as bases oficiais (scon.stj.jus.br, portal.stf.jus.br/jurisprudência) em vez de inventar uma ementa. Antes de citar uma norma em uma peça, verifique o texto vigente na fonte oficial, porque a legislação muda.

---

## 7. Passo 4: editar documentos

Este e o centro do trabalho diario. O Patron edita documentos de três formas. Todas terminam em um arquivo que você abre no Word.

### 7A. Pedir uma alteração, revisar as sugestoes, aceitar

E o jeito mais pratico para correções pontuais em um contrato ou peça.

1. No Explorador, **clique em um documento DOCX**. Ele aparece no painel central (**Visualização do documento**).
2. No Assistente, escreva o que você quer, **indicando o ponto**:
   - "Proponha uma alteração na cláusula 4. Quero limitar a responsabilidade da contratada aos danos emergentes, excluindo lucros cessantes."
   - "Adicione na cláusula 3 uma cláusula de eleição de foro na comarca da sede da contratante."
   - "Reformule a cláusula 7 para que o prazo de aviso previo seja de 3 meses, com efeito a partir do fim do mês."
3. O Patron responde com **cartoes de alteração**. Cada cartao mostra:
   - o texto **adicionado** em verde,
   - o texto **removido** em vermelho, riscado,
   - uma breve **justificativa** da alteração.
4. Cada cartao oferece três botoes:
   - **Aceitar:** o Patron aplica a alteração e cria uma **nova versão** do documento (revisões reais do Word),
   - **Rejeitar:** a alteração desaparece,
   - **Abrir:** pre-visualização da alteração no contexto do documento inteiro.
5. Depois de aceitar, baixe o arquivo final (icone de download ao lado do documento) e abra no Word. Você vera as alterações como uma revisão aguardando aceitação final.

> Você pode aceitar as alterações uma a uma ou em bloco. Cada aceitação salva uma nova versão e as versões anteriores ficam no histórico, então nada se perde.

### 7B. Aprimorar uma peça inteira: "Minuta de resposta" (revisor, advogado do diabo, linguagem)

E o modo para uma peça inteira, ou para um trecho mais longo que você quer reforcar.

1. Abra o painel **Minuta de resposta** (o icone ao lado da resposta do assistente, ou pelo menu).
2. No campo **Texto da peça**, cole o seu texto de trabalho.
3. Escolha a perspectiva do advogado do diabo (**"a partir de qual perspectiva"**):
   - **Parte contraria:** como o advogado da outra parte vai atacar,
   - **O tribunal:** sobre o que o colegiado vai questionar,
   - **Ministerio Público:** o angulo da acusação.
4. Clique em **Aprimorar a peça**. O Patron passa o texto por três etapas:
   - **Revisor:** aponta lacunas logicas e referências fracas, e reforca a argumentação,
   - **Advogado do diabo:** antecipa e rebate os contra-argumentos a partir da perspectiva escolhida,
   - **Escrever com clareza:** remove o "estilo de IA" mantendo a precisão jurídica.
5. Você recebe uma **Minuta pronta** (que pode copiar) e uma seção expansível **"Como a minuta foi construida"** que mostra o que cada etapa mudou.

> **Regra 4: o pipeline rende melhor sobre um texto já pronto, não sobre um prompt vazio.** Escreva a sua versão, cole e peça para reforca-la. Depois adicione a sua revisão e, se precisar, uma segunda passada.

### 7C. Ida e volta: editar no Word, voltar ao Patron

Se preferir trabalhar no Word:

1. Baixe o documento do Patron.
2. No Word, faça **as suas alterações com o controle de alterações ativo**, adicione comentarios e, sempre que quiser que o Patron faça algo, escreva uma instrução em um comentario no formato `[PATRON: escreva aqui a instrucao]`.
3. Envie o arquivo de novo (como nova versão). O Patron le as suas alterações, os comentarios e as instruções `[PATRON: ...]`, e aprende o seu estilo de edição.

### 7D. Versões e download
- Cada alteração aceita = uma nova versão (o histórico e mantido).
- Baixe um arquivo individual pelo icone de download, ou o projeto inteiro como ZIP.

---

## 8. Passo 5: uma tabela a partir de contratos

Quando você tem **muitos documentos parecidos** (por exemplo 30 contratos de locação) e quer compara-los em uma tabela, use a **Revisão tabular**.

1. Va em **Revisões tabulares -> + Criar nova**.
2. Adicione colunas, a partir de modelos jurídicos prontos (Partes, Objeto, Multa contratual, Lei aplicável, Prazo de aviso previo...) ou suas proprias, por exemplo "Cláusula de proteção de dados: sim/não".
3. Clique em **Gerar**. A tabela vai se preenchendo em tempo real: o Patron busca em cada documento e insere o resultado.
4. Cada celula tem um selo de confiabilidade (verde/amarelo/vermelho). Vermelho significa verificação manual; clique na celula para ver a fonte.
5. Exporte para Excel para o cliente ou para a equipe.

> O ponto central: analisa uma serie de contratos em uma única passada em vez de abri-los um a um, e cada celula remete a sua fonte.

---

## 9. Passo 6: os workflows

Salve uma vez uma tarefa repetível (por exemplo "Análise de locações", "Revisão de due diligence") como **workflow** e execute em novos processos com um clique.

- Comece pelos workflows integrados.
- Os seus: **Workflows -> Adicionar workflow**, escreva as instruções passo a passo e salve.
- Você pode compartilhar um workflow com colegas, para que todo o escritório conduza a due diligence pelo mesmo checklist.

---

## 10. Passo 7: escolher o modelo

O Patron e **neutro em relação a fornecedores**, então o modelo e escolhido por você. São **duas** configurações em **Conta -> Modelos e chaves de API**: o modelo da conversa e um **Modelo de revisões tabulares** separado. As tabelas costumam receber um modelo mais barato - o trabalho e muito e cada campo e curto. Mudar qualquer uma delas não exige reinstalação.

- **Um modelo em nuvem (por exemplo Libra / Claude, Gemini)** oferece a melhor qualidade de redação e raciocinio. E a escolha normal de trabalho para um escritório. O conteúdo da sua solicitação vai então para o provedor escolhido.
- **Um modelo local (Ollama)** funciona sem internet, sem custo por uso. Exige uma instalação única do Ollama e o download do modelo no seu computador.

Você pode combinar os dois: um modelo mais barato ou local para explorar o processo, um mais forte para a peça final. Consumo e custos são controlados em **Conta -> Consumo** (com filtro por processo).

**Sigilo profissional e a nuvem.** Na versão desktop, você, advogado na sua própria maquina, e quem hospeda os dados, então a sua escolha de um modelo em nuvem e um consentimento informado. O Patron permite trabalhar com qualquer modelo, mesmo em processos marcados como confidenciais. **Todo** fluxo de dados para o modelo e registrado em um log de auditoria imutável (evidência de diligência, AI Act art. 12), e dados pessoais são mascarados antes do envio. Se o escritório quiser um regime mais rigoroso (por exemplo, processos confidenciais somente em modelo local), o administrador pode configurar isso. Por padrão, nada bloqueia o seu uso.

---

## 11. Biblioteca de habilidades

A **Biblioteca de habilidades** e um conjunto de "habilidades" que o Patron aplica ao aprimorar peças:

- **Integradas** (sempre ativas): **Revisor**, **Advogado do diabo**, **Escrever com clareza**.
- **Instaladas** (suas): você pode ativar, desativar e importar etapas adicionais de um arquivo.

As integradas não exigem nenhuma configuração. Elas trabalham no painel "Minuta de resposta".

---

## 12. Perguntas frequentes

**O assistente não responde, ou o chat retorna um erro (especialmente logo após a instalação).**
A causa mais comum e a falta da chave do modelo. Abra **Conta -> Modelos e chaves de API** e adicione uma chave (por exemplo Libra/Anthropic). A segunda causa e a falta de internet com um modelo em nuvem. Verifique também em **Conta -> Modelos e chaves de API** se o modelo selecionado e um dos que você tem chave.

**Os autos do meu processo vao para a nuvem?**
So se você escolheu um modelo em nuvem; nesse caso o conteúdo da sua solicitação vai para aquele provedor. Com um modelo local, tudo fica no seu computador. Os arquivos, as bases de dados e o histórico de conversas ficam sempre armazenados localmente.

**O Patron escreveu algo que não esta no processo.**
Olhe o selo: vermelho significa não verificado. Modelos podem "preencher lacunas". O selo e a sua própria verificação são o filtro final, e o Patron não os substitui.

**A conversão DOCX/PDF não funciona.**
A conversão de documentos exige o LibreOffice no computador. Se algo estiver faltando, avise o administrador do escritório.

**Como eu exporto para o Word uma peça com comentarios?**
Peça as alterações como revisões (Passo 4A), aceite as que quiser e baixe o DOCX. No Word você vera uma revisão aguardando aceitação final.

**O Patron verifica se uma norma esta vigente?**
As bases de dados oferecem acesso rápido ao texto, mas podem estar atrasadas em relação ao Diario Oficial. Verifique o texto vigente na fonte oficial antes de redigir.

**O Patron toma decisões jurídicas?**
Não. A avaliação jurídica, a assinatura e a responsabilidade profissional são suas.

---

## 13. Lembrete: prompts prontos

**Chat com os autos do processo**
- "Liste todos os prazos e multas contratuais deste contrato."
- "Quais incoerencias existem entre o documento A e o documento B?"
- "Ha risco de prescrição? Aponte as datas no processo."

**Legislação e processos**
- "Mostre o art. [X] do [código] vigente."
- "Qual o histórico de alterações do art. [X] da [lei]?"
- "Consulte o processo [número] no DataJud."
- Com os conectores polacos ativados: "Verifique [nome da empresa] no KRS."

**Editar um documento (depois de clicar em um arquivo DOCX)**
- "Proponha uma alteração na cláusula [X]: [o que você quer], como revisão."
- "Adicione na cláusula [X] uma cláusula [descrição]."
- "Reformule a cláusula [X]: [novo texto ou objetivo]."

**Aprimorar uma peça**
- O painel "Minuta de resposta": cole o texto, escolha a perspectiva, depois "Aprimorar a peça".

---

*O Patron e uma ferramenta de apoio ao trabalho do advogado. Toda peça e revisada e assinada pelo Advogado antes do envio. Este documento reflete o estado do aplicativo em julho de 2026.*
