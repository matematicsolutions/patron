# Patron: guia para el Letrado

**Paso a paso, desde el primer arranque hasta el escrito terminado.**
Corresponde al instalador de junio de 2026. No necesita ninguna preparacion tecnica. Si sabe trabajar con documentos en Word, sabe usar Patron.

---

## Indice

1. [Que es Patron (en un parrafo)](#1-que-es-patron)
2. [Primer arranque](#2-primer-arranque)
3. [Mapa de la pantalla: tres paneles](#3-mapa-de-la-pantalla)
4. [Paso 1: crear un expediente y subir los archivos](#4-paso-1-crear-un-expediente-y-subir-los-archivos)
5. [Paso 2: chatear con los autos del expediente](#5-paso-2-chatear-con-los-autos-del-expediente)
6. [Paso 3: buscar jurisprudencia y legislacion](#6-paso-3-jurisprudencia-y-legislacion)
7. [Paso 4: trabajar con documentos y EDITARLOS](#7-paso-4-editar-los-documentos)
8. [Paso 5: una tabla a partir de un lote de contratos (Revision tabular)](#8-paso-5-una-tabla-a-partir-de-los-contratos)
9. [Paso 6: flujos de trabajo (tareas repetibles)](#9-paso-6-flujos-de-trabajo)
10. [Paso 7: elegir un modelo de IA](#10-paso-7-elegir-un-modelo)
11. [Biblioteca de habilidades](#11-biblioteca-de-habilidades)
12. [Preguntas y problemas frecuentes](#12-faq)
13. [Chuleta: prompts listos para usar](#13-chuleta)

---

## 1. Que es Patron

Patron es su asistente juridico instalado **en su propio ordenador** (una aplicacion de escritorio, como Word). Usted sube los autos del expediente (contratos, demandas, sentencias, escaneos) y Patron:

- **los lee por usted** y responde a sus preguntas, citando las fuentes de sus propios documentos,
- **busca jurisprudencia** y **legislacion** (derecho espanol y derecho de la UE) en un conjunto de bases de datos integradas,
- **propone cambios a los documentos** en forma de revisiones (el control de cambios de Word), que usted acepta con un solo clic,
- **perfecciona sus escritos** (revision, abogado del diablo, edicion linguistica).

Patron no toma decisiones juridicas y no sustituye su criterio. Es una herramienta: una lectura mas rapida del expediente y un primer borrador que usted verifica en todo caso.

---

## 2. Primer arranque

1. Inicie **PATRON** (el icono del escritorio o el menu Inicio). Vera una pantalla de carga y, tras una decena de segundos, la ventana principal. No hace falta ninguna cuenta ni inicio de sesion. Patron es de un solo usuario y local, por lo que los autos del expediente, las bases de datos y el historial de chats permanecen en su ordenador.
2. **Anada la clave de un modelo de IA.** Es el unico paso sin el cual el asistente no responde. Abra **Cuenta → Modelos y claves API** y pegue la clave de su proveedor (por ejemplo Libra/Anthropic, o Gemini/OpenAI). Guardela. A partir de ese momento el chat, la edicion de documentos y las tablas funcionan. Detalles: [Paso 7](#10-paso-7-elegir-un-modelo).
3. **Internet y conversion de archivos.** Un modelo en la nube y la busqueda en vivo de jurisprudencia y legislacion (BOE) requieren conexion a internet. La busqueda en sus propios documentos tambien funciona sin conexion. Si al subir archivos `.doc` antiguos aparece un error de conversion, pida a su administrador que instale LibreOffice (es gratuito).

> **Consejo:** Patron se dirige a usted como "Letrado". Le habla en espanol y redacta los escritos en espanol, porque se presentan ante los tribunales espanoles. No sabe por donde empezar? Preguntele directamente en el chat: **"Que sabes hacer?"** o **"Por donde empiezo?"**, y le presentara sus funciones paso a paso. Si no ve algo, expanda el panel de la izquierda (**Explorador**).

---

## 3. Mapa de la pantalla

La pantalla del asistente esta dividida en **tres paneles verticales**:

| Panel | Nombre | Para que sirve |
|---|---|---|
| **izquierdo** | **Explorador** | la lista de expedientes (proyectos) y documentos; es aqui donde sube los archivos |
| **central** | **Visor de documentos** | el contenido del documento que ha pulsado; es aqui donde aparecen las revisiones |
| **derecho** | **Asistente** | el chat, donde plantea preguntas e imparte instrucciones |

Puede contraer el panel de la izquierda ("Contraer el explorador") y volver a expandirlo cuando necesite espacio para el visor.

---

## 4. Paso 1: crear un expediente y subir los archivos

**Regla 1: un expediente = un proyecto.** No mezcle archivos de asuntos distintos. Para cada pregunta que plantea, Patron busca en todos los documentos del proyecto.

### 4.1. Crear un proyecto
1. En el panel de la izquierda, pulse **Nuevo proyecto** (o "Nuevo expediente", atajo **Ctrl+N**).
2. Dele un nombre descriptivo, por ejemplo `Garcia c. Construcciones Bianchi S.L., demanda 2026`.

### 4.2. Subir documentos: tres formas

- **Arrastrar y soltar:** seleccione los archivos o la carpeta en el Explorador de archivos de Windows y sueltelos sobre el panel (vera "Suelte para subir").
- **Subir documentos:** el boton del panel de la izquierda, despues elija los archivos (PDF, DOCX, DOC).
- **Importar la carpeta del expediente** (la opcion mas rapida con muchos archivos): indique la ruta de la carpeta, por ejemplo `C:\Expedientes\Garcia-2026`. Patron importara todos los archivos de una vez, los analizara por seguridad y los indexara.

Que ocurre entre bastidores (usted no tiene que hacer nada): Patron reconoce la estructura de redaccion del documento (articulos, apartados, puntos), ejecuta el OCR sobre los escaneos y el texto completo entra en la busqueda. Tambien funcionan los escaneos en papel y los archivos sin capa de texto.

> **Regla 2: suba TODOS los autos del expediente antes de la primera pregunta.** Cuanto mas completo sea el expediente, mas precisas seran las respuestas. Los documentos anadidos despues no cambiaran retroactivamente las respuestas anteriores.

---

## 5. Paso 2: chatear con los autos del expediente

En el panel de la derecha (**Asistente**), escriba su pregunta y enviela. Patron selecciona por si mismo los pasajes mas relevantes de todo el expediente (usted no necesita pegar ningun texto).

**Plantee preguntas concretas.** En lugar de "que hay en el contrato", escriba:
- "Que obligaciones tiene el comitente conforme a la clausula 5 del contrato n. 3?"
- "Enumera todos los plazos de pago y las penalizaciones contractuales de este contrato."
- "Hay fundamentos para una excepcion de prescripcion? Senala las fechas del expediente."
- "Que incongruencias hay entre el contrato principal y el anexo n. 2?"

### Lea la etiqueta de color junto a las citas
Cada cita extraida de sus documentos recibe un indicador de fiabilidad:

- verde: cita literal, encontrada en los autos de su expediente. Puede usarla en un escrito indicando la fuente.
- amarillo: posible reelaboracion o parafrasis. Compruebela contra el original.
- rojo: no encontrada en el expediente. **No la cite sin una verificacion manual.** Puede ser una formulacion que solo suena como una cita.

> **Regla 3: antes de pegar una cita en un escrito, mire la etiqueta.** Es su filtro anti-alucinaciones.

---

## 6. Paso 3: jurisprudencia y legislacion

La edicion espanola de Patron llega con **el conector del derecho espanol integrado** (funciona nada mas instalarse, sin configuracion):

| Base de datos | Que encontrara en ella |
|---|---|
| **BOE** | la legislacion estatal consolidada: Boletin Oficial del Estado, textos normativos con su identificador id/ELI |

Los demas conectores NO estan incluidos en el instalador - la edicion se mantiene ligera. El derecho de la UE (**EUR-Lex**, el corpus de conformidad **EU-Compliance** sin conexion: RGPD, AI Act, DORA, NIS2, eIDAS 2.0, CRA) y los conectores de otras jurisdicciones (incluidos los polacos: SAOS, NSA, ISAP, KRS) se descargan por separado de la **MateMatic Boutique** (matematicsolutions.com/boutique) y se acoplan a la aplicacion. Una vez instalados, los activa en los ajustes: **Cuenta → Conectores** ("Conectores juridicos").

Pregunte en lenguaje natural y Patron elegira por si mismo la base de datos correcta:

- "Muestrame el articulo 1902 del Codigo Civil."
- "Busca en el BOE la regulacion vigente sobre plazos de prescripcion de las acciones."
- Con el conector EU-Compliance instalado desde la Boutique: "Cual es la definicion de sistema de IA de alto riesgo en el AI Act?"
- Con los conectores polacos instalados desde la Boutique: "Comprueba el consejo de administracion de Nowak-Bud sp. z o.o. en el KRS." Las busquedas de jurisprudencia polaca devuelven sentencias reales de la base de datos SAOS, por ejemplo **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, con fechas y enlaces.

> **Recuerde:** las bases de datos son un acceso rapido y un punto de partida. Antes de citar una disposicion en un escrito, verifique su texto vigente en la fuente oficial, porque la legislacion cambia.

---

## 7. Paso 4: editar los documentos

Este es el nucleo del trabajo diario. Patron edita los documentos de tres maneras. Todas terminan en un archivo que usted abre en Word.

### 7A. Pedir un cambio, examinar las revisiones, aceptar

Es el modo mas comodo para las correcciones puntuales en un contrato o en un escrito.

1. En el Explorador, **pulse un documento DOCX**. Aparece en el panel central (**Visor de documentos**).
2. En el Asistente, escriba lo que quiere, **indicando el lugar**:
   - "Propon un cambio a la clausula 4. Quiero limitar la responsabilidad del contratista al dano emergente, con exclusion del lucro cesante."
   - "Anade a la clausula 3 una estipulacion que designe como fuero competente el del domicilio social del comitente."
   - "Redacta de nuevo la clausula 7 para que el plazo de preaviso sea de 3 meses, con efecto al final del mes."
3. Patron responde con **tarjetas de cambio**. Cada tarjeta muestra:
   - el texto **anadido** en verde,
   - el texto **eliminado** en rojo, tachado,
   - una breve **justificacion** del cambio.
4. Cada tarjeta le ofrece tres botones:
   - **Aceptar:** Patron aplica el cambio y crea una **nueva version** del documento (revisiones autenticas de Word),
   - **Rechazar:** el cambio desaparece,
   - **Abrir:** vista previa del cambio en el contexto de todo el documento.
5. Una vez aceptado, descargue el archivo terminado (el icono de descarga junto al documento) y abralo en Word. Vera los cambios como una revision a la espera de la aceptacion final.

> Puede aceptar los cambios uno por uno o en bloque. Cada aceptacion guarda una nueva version y las versiones anteriores permanecen en el historial, de modo que no pierde nada.

### 7B. Perfeccionar un escrito completo: "Borrador de respuesta" (revision, abogado del diablo, lenguaje)

Es el modo para un escrito completo, o para un pasaje mas largo que quiere reforzar.

1. Abra el panel **Borrador de respuesta** (el icono bajo la respuesta del asistente, o desde el menu).
2. En el campo **Texto del escrito**, pegue su texto de trabajo.
3. Elija la perspectiva para el abogado del diablo (**"desde que perspectiva"**):
   - **Parte contraria:** como lo atacara el letrado de la otra parte,
   - **El tribunal:** sobre que preguntara la sala,
   - **Fiscal:** el angulo de la acusacion.
4. Pulse **Perfeccionar el escrito**. Patron hace pasar el texto por tres etapas:
   - **Revisor:** senala las lagunas de logica y los apoyos debiles, y refuerza la argumentacion,
   - **Abogado del diablo:** anticipa y rebate las contraargumentaciones desde la perspectiva elegida,
   - **Escribir en lenguaje claro:** elimina el "estilo IA" manteniendo la precision juridica.
5. Obtiene un **Borrador listo** (que puede copiar) y una seccion desplegable **"Como se elaboro el borrador"** que muestra que cambio cada etapa.

> **Regla 4: la cadena rinde al maximo sobre un texto terminado, no sobre un prompt vacio.** Escriba su propia version, peguela y pida reforzarla. Despues anada su propia revision y, si hace falta, una segunda pasada.

### 7C. Ida y vuelta: editar en Word, volver a Patron

Si prefiere trabajar en Word:

1. Descargue el documento de Patron.
2. En Word, aplique **sus propios cambios con el control de cambios activo**, anada comentarios y, dondequiera que quiera que Patron haga algo, escriba una instruccion en un comentario con el formato `[PATRON: escriba aqui la instruccion]`.
3. Suba de nuevo el archivo (como nueva version). Patron lee sus revisiones, los comentarios y las instrucciones `[PATRON: ...]`, y aprende su estilo de edicion.

### 7D. Versiones y descargas
- Cada cambio aceptado = una nueva version (el historial se conserva).
- Descargue un unico archivo con el icono de descarga, o el proyecto entero como ZIP.

---

## 8. Paso 5: una tabla a partir de los contratos

Cuando tiene **muchos documentos similares** (por ejemplo 30 contratos de arrendamiento) y quiere compararlos en una tabla, use la **Revision tabular**.

1. Vaya a **Revisiones tabulares → + Crear nueva**.
2. Anada columnas, ya sea a partir de los presets juridicos listos (Partes, Objeto, Penalizacion contractual, Ley aplicable, Plazo de preaviso…) o propias, por ejemplo "Clausula RGPD: si/no".
3. Pulse **Generar**. La tabla se rellena en streaming: Patron busca en cada documento e introduce el resultado.
4. Cada celda tiene una etiqueta de fiabilidad (verde/amarillo/rojo). El rojo significa verificacion manual; pulse la celda para ver la fuente.
5. Exporte a Excel para el cliente o el equipo.

> El sentido: examina un lote de contratos en una sola pasada en lugar de abrirlos uno por uno, y cada celda remite a su fuente.

---

## 9. Paso 6: flujos de trabajo

Guarde una vez una tarea repetible (por ejemplo "Analisis de arrendamientos", "Revision de due diligence") como **flujo de trabajo** y ejecutela sobre nuevos expedientes con un solo clic.

- Empiece con los flujos de trabajo integrados.
- Los suyos: **Flujos de trabajo → Anadir flujo de trabajo**, escriba las instrucciones paso a paso y guarde.
- Puede compartir un flujo de trabajo con los companeros, de modo que todo el despacho conduzca la due diligence sobre la misma lista de comprobacion.

---

## 10. Paso 7: elegir un modelo

Patron es **neutral respecto a los proveedores**, de modo que el modelo lo elige usted. Es un solo ajuste en **Cuenta → Modelos y claves API**, y cambiarlo no requiere ninguna reinstalacion.

- **Un modelo en la nube (por ejemplo Libra / Claude, Gemini)** ofrece la mejor calidad de redaccion y de razonamiento. Es la eleccion ordinaria de trabajo para un despacho. El contenido de su consulta va entonces al proveedor que ha elegido.
- **Un modelo local (Ollama)** funciona sin internet, a coste cero. Requiere una instalacion unica de Ollama y la descarga del modelo a su ordenador.

Puede combinarlos: un modelo mas economico o local para explorar el expediente, uno mas potente para el escrito final. El consumo y los costes se controlan en **Cuenta → Uso** (con filtro por asunto).

**Asuntos amparados por el secreto profesional y la nube.** En la version de escritorio usted, letrado en su propia maquina, es el anfitrion de los datos, de modo que su eleccion de un modelo en la nube es un consentimiento informado. Patron le permite trabajar con cualquier modelo, incluso en los asuntos marcados como reservados. **Cada** flujo de datos hacia el modelo queda registrado en un registro de auditoria inmutable (prueba de diligencia, AI Act art. 12), y los datos personales se enmascaran antes de enviarse. Si el despacho quiere un regimen mas estricto (por ejemplo, los asuntos reservados solo con un modelo local), el administrador puede establecerlo. Por defecto nada le bloquea.

---

## 11. Biblioteca de habilidades

La **Biblioteca de habilidades** es un conjunto de "habilidades" que Patron aplica cuando perfecciona los escritos:

- **Integradas** (siempre activas): **Revisor**, **Abogado del diablo**, **Escribir en lenguaje claro**.
- **Instaladas** (las suyas): puede activar, desactivar e importar etapas adicionales desde un archivo.

Las integradas no requieren ninguna configuracion. Trabajan en el panel "Borrador de respuesta".

---

## 12. FAQ

**El asistente no responde, o el chat devuelve un error (sobre todo nada mas instalarse).**
La causa mas comun es la falta de la clave del modelo. Abra **Cuenta → Modelos y claves API** y anada una clave (por ejemplo Libra/Anthropic). La segunda causa es la falta de internet con un modelo en la nube. Compruebe tambien en **Cuenta → Modelos y claves API** que el modelo seleccionado sea uno del que posee la clave.

**Mis autos del expediente salen a la nube?**
Solo si ha elegido un modelo en la nube; en ese caso el contenido de su consulta va a ese proveedor. Con un modelo local, todo permanece en su ordenador. Los archivos, las bases de datos y el historial de chats se almacenan siempre en local.

**Patron ha escrito algo que no esta en el expediente.**
Mire la etiqueta: el rojo significa no verificado. Los modelos pueden "rellenar los huecos". La etiqueta y su propia verificacion son el filtro final, y Patron no lo sustituye.

**La conversion DOCX/PDF no funciona.**
La conversion de documentos requiere LibreOffice en el ordenador. Si falta algo, planteelo al administrador del despacho.

**Como exporto a Word un escrito con comentarios?**
Pida los cambios como revisiones (Paso 4A), acepte los que quiera y descargue el DOCX. En Word vera una revision a la espera de la aceptacion final.

**Patron comprueba si una norma esta vigente?**
Las bases de datos ofrecen un acceso rapido al texto, pero pueden ir por detras del BOE. Verifique el texto vigente en la fuente oficial antes de redactar.

**Patron toma decisiones juridicas?**
No. La valoracion juridica, la firma y la responsabilidad profesional son suyas.

---

## 13. Chuleta: prompts listos para usar

**Chat con los autos del expediente**
- "Enumera todos los plazos y las penalizaciones contractuales de este contrato."
- "Que incongruencias hay entre el documento A y el documento B?"
- "Hay un problema de prescripcion? Senala las fechas del expediente."

**Jurisprudencia y legislacion**
- "Muestra el articulo [X] del [codigo]."
- "Busca en el BOE la regulacion vigente sobre [tema]."
- Con los conectores polacos activados: "Comprueba [nombre de la sociedad] en el KRS."

**Editar un documento (tras pulsar un archivo DOCX)**
- "Propon un cambio a la clausula [X]: [lo que quiere], como revisiones."
- "Anade a la clausula [X] una estipulacion [descripcion]."
- "Redacta de nuevo la clausula [X]: [nuevo texto u objetivo]."

**Perfeccionar un escrito**
- El panel "Borrador de respuesta": pegue el texto, elija la perspectiva, despues "Perfeccionar el escrito".

---

*Patron es una herramienta que apoya el trabajo del letrado. Cada escrito lo verifica y lo firma el Letrado antes de enviarlo. Este documento refleja el estado de la aplicacion a junio de 2026.*
