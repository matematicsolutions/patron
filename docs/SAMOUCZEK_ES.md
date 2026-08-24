# Patron: guia para el Letrado

**Paso a paso, desde el primer arranque hasta el escrito terminado.**
Corresponde al instalador de junio de 2026. No necesita ninguna preparacion técnica. Si sabe trabajar con documentos en Word, sabe usar Patron.

---

## Indice

1. [Que es Patron (en un párrafo)](#1-que-es-patron)
2. [Primer arranque](#2-primer-arranque)
3. [Mapa de la pantalla: tres paneles](#3-mapa-de-la-pantalla)
4. [Paso 1: crear un expediente y subir los archivos](#4-paso-1-crear-un-expediente-y-subir-los-archivos)
5. [Paso 2: chatear con los autos del expediente](#5-paso-2-chatear-con-los-autos-del-expediente)
6. [Paso 3: buscar jurisprudencia y legislación](#6-paso-3-jurisprudencia-y-legislación)
7. [Paso 4: trabajar con documentos y EDITARLOS](#7-paso-4-editar-los-documentos)
8. [Paso 5: una tabla a partir de un lote de contratos (Revisión tabular)](#8-paso-5-una-tabla-a-partir-de-los-contratos)
9. [Paso 6: flujos de trabajo (tareas repetibles)](#9-paso-6-flujos-de-trabajo)
10. [Paso 7: elegir un modelo de IA](#10-paso-7-elegir-un-modelo)
11. [Biblioteca de habilidades](#11-biblioteca-de-habilidades)
12. [Preguntas y problemas frecuentes](#12-faq)
13. [Chuleta: prompts listos para usar](#13-chuleta-prompts-listos-para-usar)

---

## 1. Que es Patron

Patron es su asistente jurídico instalado **en su propio ordenador** (una aplicación de escritorio, como Word). Usted sube los autos del expediente (contratos, demandas, sentencias, escaneos) y Patron:

- **los lee por usted** y responde a sus preguntas, citando las fuentes de sus propios documentos,
- **busca jurisprudencia** y **legislación** (derecho espanol y derecho de la UE) en un conjunto de bases de datos integradas,
- **propone cambios a los documentos** en forma de revisiones (el control de cambios de Word), que usted acepta con un solo clic,
- **perfecciona sus escritos** (revisión, abogado del diablo, edición lingüística).

Patron no toma decisiones jurídicas y no sustituye su criterio. Es una herramienta: una lectura mas rápida del expediente y un primer borrador que usted verifica en todo caso.

---

## 2. Primer arranque

1. Inicie **PATRON** (el icono del escritorio o el menu Inicio). Vera una pantalla de carga y, tras una decena de segundos, la ventana principal. No hace falta ninguna cuenta ni inicio de sesion. Patron es de un solo usuario y local, por lo que los autos del expediente, las bases de datos y el historial de chats permanecen en su ordenador.
2. **Anada la clave de un modelo de IA.** Es el único paso sin el cual el asistente no responde. Abra **Cuenta → Modelos y claves API** y pegue la clave de su proveedor (por ejemplo Libra/Anthropic, o Gemini/OpenAI). Guardela. A partir de ese momento el chat, la edición de documentos y las tablas funcionan. Detalles: [Paso 7](#10-paso-7-elegir-un-modelo).
3. **Internet y conversión de archivos.** Un modelo en la nube y la busqueda en vivo de jurisprudencia y legislación (BOE) requieren conexion a internet. La busqueda en sus propios documentos también funciona sin conexion. Si al subir archivos `.doc` antiguos aparece un error de conversión, pida a su administrador que instale LibreOffice (es gratuito).

> **Consejo:** Patron se dirige a usted como "Letrado". Le habla en espanol y redacta los escritos en espanol, porque se presentan ante los tribunales espanoles. No sabe por donde empezar? Preguntele directamente en el chat: **"Que sabes hacer?"** o **"Por donde empiezo?"**, y le presentara sus funciones paso a paso. Si no ve algo, expanda el panel de la izquierda (**Explorador**).

---

## 3. Mapa de la pantalla

La pantalla del asistente esta dividida en **tres paneles verticales**:

| Panel | Nombre | Para que sirve |
|---|---|---|
| **izquierdo** | **Explorador** | la lista de expedientes (proyectos) y documentos; es aquí donde sube los archivos |
| **central** | **Visor de documentos** | el contenido del documento que ha pulsado; es aquí donde aparecen las revisiones |
| **derecho** | **Asistente** | el chat, donde plantea preguntas e imparte instrucciones |

Puede contraer el panel de la izquierda ("Contraer el explorador") y volver a expandirlo cuando necesite espacio para el visor.

---

## 4. Paso 1: crear un expediente y subir los archivos

**Regla 1: un expediente = un proyecto.** No mezcle archivos de asuntos distintos. Para cada pregunta que plantea, Patron busca en todos los documentos del proyecto.

### 4.1. Crear un proyecto
1. En el panel de la izquierda, pulse **Nuevo proyecto** (o "Nuevo expediente", atajo **Ctrl+N**).
2. Dele un nombre descriptivo, por ejemplo `Garcia c. Construcciones Bianchi S.L., demanda 2026`, y rellene la **Referencia** - aparece después como columna propia en la lista de casos.

### 4.2. Subir documentos: tres formas

- **Arrastrar y soltar:** seleccione los archivos o la carpeta en el Explorador de archivos de Windows y sueltelos sobre el panel (vera "Suelte para subir").
- **Subir documentos:** el boton del panel de la izquierda, después elija los archivos (PDF, DOCX, DOC).
- **Importar la carpeta del expediente** (la opción mas rápida con muchos archivos): indique la ruta de la carpeta, por ejemplo `C:\Expedientes\Garcia-2026`. Patron importara todos los archivos de una vez, los analizara por seguridad y los indexara.

Que ocurre entre bastidores (usted no tiene que hacer nada): Patron reconoce la estructura de redacción del documento (articulos, apartados, puntos), ejecuta el OCR sobre los escaneos y el texto completo entra en la busqueda. También funcionan los escaneos en papel y los archivos sin capa de texto.

> **Regla 2: suba TODOS los autos del expediente antes de la primera pregunta.** Cuanto mas completo sea el expediente, mas precisas serán las respuestas. Los documentos anadidos después no cambiaran retroactivamente las respuestas anteriores.

---

## 5. Paso 2: chatear con los autos del expediente

En el panel de la derecha (**Asistente**), escriba su pregunta y enviela. Patron selecciona por si mismo los pasajes mas relevantes de todo el expediente (usted no necesita pegar ningun texto).

**Plantee preguntas concretas.** En lugar de "que hay en el contrato", escriba:
- "Que obligaciones tiene el comitente conforme a la cláusula 5 del contrato n. 3?"
- "Enumera todos los plazos de pago y las penalizaciones contractuales de este contrato."
- "Hay fundamentos para una excepción de prescripción? Senala las fechas del expediente."
- "Que incongruencias hay entre el contrato principal y el anexo n. 2?"

### Lea la etiqueta de color junto a las citas
Cada cita extraida de sus documentos recibe un indicador de fiabilidad:

- verde: cita literal, encontrada en los autos de su expediente. Puede usarla en un escrito indicando la fuente.
- amarillo: posible reelaboracion o parafrasis. Compruebela contra el original.
- rojo: no encontrada en el expediente. **No la cite sin una verificación manual.** Puede ser una formulación que solo suena como una cita.

> **Regla 3: antes de pegar una cita en un escrito, mire la etiqueta.** Es su filtro anti-alucinaciones.

---

## 6. Paso 3: jurisprudencia y legislación

La edición espanola de Patron llega con **el conector del derecho espanol integrado** (funciona nada mas instalarse, sin configuración):

| Base de datos | Que encontrara en ella |
|---|---|
| **BOE** | la legislación estatal consolidada: Boletin Oficial del Estado, textos normativos con su identificador id/ELI |

Los demás conectores NO estan incluidos en el instalador - la edición se mantiene ligera. El derecho de la UE (**EUR-Lex**, el corpus de conformidad **EU-Compliance** sin conexion: RGPD, AI Act, DORA, NIS2, eIDAS 2.0, CRA) y los conectores de otras jurisdicciones (incluidos los polacos: SAOS, NSA, ISAP, KRS) se descargan por separado de la **MateMatic Boutique** (matematicsolutions.com/boutique) y se acoplan a la aplicación. Una vez instalados, los activa en los ajustes: **Cuenta → Conectores** ("Conectores jurídicos").

Pregunte en lenguaje natural y Patron elegira por si mismo la base de datos correcta:

- "Muestrame el articulo 1902 del Código Civil."
- "Busca en el BOE la regulacion vigente sobre plazos de prescripción de las acciones."
- Con el conector EU-Compliance instalado desde la Boutique: "Cual es la definición de sistema de IA de alto riesgo en el AI Act?"
- Con los conectores polacos instalados desde la Boutique: "Comprueba el consejo de administración de Nowak-Bud sp. z o.o. en el KRS." Las busquedas de jurisprudencia polaca devuelven sentencias reales de la base de datos SAOS, por ejemplo **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, con fechas y enlaces.

> **Recuerde:** las bases de datos son un acceso rápido y un punto de partida. Antes de citar una disposición en un escrito, verifique su texto vigente en la fuente oficial, porque la legislación cambia.

---

## 7. Paso 4: editar los documentos

Este es el nucleo del trabajo diario. Patron edita los documentos de tres maneras. Todas terminan en un archivo que usted abre en Word.

### 7A. Pedir un cambio, examinar las revisiones, aceptar

Es el modo mas comodo para las correcciones puntuales en un contrato o en un escrito.

1. En el Explorador, **pulse un documento DOCX**. Aparece en el panel central (**Visor de documentos**).
2. En el Asistente, escriba lo que quiere, **indicando el lugar**:
   - "Propon un cambio a la cláusula 4. Quiero limitar la responsabilidad del contratista al dano emergente, con exclusión del lucro cesante."
   - "Anade a la cláusula 3 una estipulación que designe como fuero competente el del domicilio social del comitente."
   - "Redacta de nuevo la cláusula 7 para que el plazo de preaviso sea de 3 meses, con efecto al final del mes."
3. Patron responde con **tarjetas de cambio**. Cada tarjeta muestra:
   - el texto **anadido** en verde,
   - el texto **eliminado** en rojo, tachado,
   - una breve **justificación** del cambio.
4. Cada tarjeta le ofrece tres botones:
   - **Aceptar:** Patron aplica el cambio y crea una **nueva versión** del documento (revisiones autenticas de Word),
   - **Rechazar:** el cambio desaparece,
   - **Abrir:** vista previa del cambio en el contexto de todo el documento.
5. Una vez aceptado, descargue el archivo terminado (el icono de descarga junto al documento) y abralo en Word. Vera los cambios como una revisión a la espera de la aceptación final.

> Puede aceptar los cambios uno por uno o en bloque. Cada aceptación guarda una nueva versión y las versiones anteriores permanecen en el historial, de modo que no pierde nada.

### 7B. Perfeccionar un escrito completo: "Borrador de respuesta" (revisión, abogado del diablo, lenguaje)

Es el modo para un escrito completo, o para un pasaje mas largo que quiere reforzar.

1. Abra el panel **Borrador de respuesta** (el icono bajo la respuesta del asistente, o desde el menu).
2. En el campo **Texto del escrito**, pegue su texto de trabajo.
3. Elija la perspectiva para el abogado del diablo (**"desde que perspectiva"**):
   - **Parte contraria:** como lo atacara el letrado de la otra parte,
   - **El tribunal:** sobre que preguntara la sala,
   - **Fiscal:** el angulo de la acusación.
4. Pulse **Perfeccionar el escrito**. Patron hace pasar el texto por tres etapas:
   - **Revisor:** senala las lagunas de lógica y los apoyos debiles, y refuerza la argumentación,
   - **Abogado del diablo:** anticipa y rebate las contraargumentaciones desde la perspectiva elegida,
   - **Escribir en lenguaje claro:** elimina el "estilo IA" manteniendo la precision jurídica.
5. Obtiene un **Borrador listo** (que puede copiar) y una sección desplegable **"Como se elaboro el borrador"** que muestra que cambio cada etapa.

> **Regla 4: la cadena rinde al máximo sobre un texto terminado, no sobre un prompt vacio.** Escriba su propia versión, peguela y pida reforzarla. Después anada su propia revisión y, si hace falta, una segunda pasada.

### 7C. Ida y vuelta: editar en Word, volver a Patron

Si prefiere trabajar en Word:

1. Descargue el documento de Patron.
2. En Word, aplique **sus propios cambios con el control de cambios activo**, anada comentarios y, dondequiera que quiera que Patron haga algo, escriba una instrucción en un comentario con el formato `[PATRON: escriba aqui la instruccion]`.
3. Suba de nuevo el archivo (como nueva versión). Patron lee sus revisiones, los comentarios y las instrucciones `[PATRON: ...]`, y aprende su estilo de edición.

### 7D. Versiones y descargas
- Cada cambio aceptado = una nueva versión (el historial se conserva).
- Descargue un único archivo con el icono de descarga, o el proyecto entero como ZIP.

---

## 8. Paso 5: una tabla a partir de los contratos

Cuando tiene **muchos documentos similares** (por ejemplo 30 contratos de arrendamiento) y quiere compararlos en una tabla, use la **Revisión tabular**.

1. Vaya a **Revisiones tabulares → + Crear nueva**.
2. Anada columnas, ya sea a partir de los presets jurídicos listos (Partes, Objeto, Penalizacion contractual, Ley aplicable, Plazo de preaviso…) o propias, por ejemplo "Cláusula RGPD: si/no".
3. Pulse **Generar**. La tabla se rellena en streaming: Patron busca en cada documento e introduce el resultado.
4. Cada celda tiene una etiqueta de fiabilidad (verde/amarillo/rojo). El rojo significa verificación manual; pulse la celda para ver la fuente.
5. Exporte a Excel para el cliente o el equipo.

> El sentido: examina un lote de contratos en una sola pasada en lugar de abrirlos uno por uno, y cada celda remite a su fuente.

---

## 9. Paso 6: flujos de trabajo

Guarde una vez una tarea repetible (por ejemplo "Análisis de arrendamientos", "Revisión de due diligence") como **flujo de trabajo** y ejecutela sobre nuevos expedientes con un solo clic.

- Empiece con los flujos de trabajo integrados.
- Los suyos: **Flujos de trabajo → Anadir flujo de trabajo**, escriba las instrucciones paso a paso y guarde.
- Puede compartir un flujo de trabajo con los companeros, de modo que todo el despacho conduzca la due diligence sobre la misma lista de comprobación.

---

## 10. Paso 7: elegir un modelo

Patron es **neutral respecto a los proveedores**, de modo que el modelo lo elige usted. Son **dos** ajustes en **Cuenta → Modelos y claves API**: el modelo de la conversación y un **Modelo para revisiones tabulares** aparte. A las tablas se les suele dar un modelo mas barato - el trabajo es mucho y cada campo es corto. Cambiar cualquiera de los dos no requiere ninguna reinstalación.

- **Un modelo en la nube (por ejemplo Libra / Claude, Gemini)** ofrece la mejor calidad de redacción y de razonamiento. Es la elección ordinaria de trabajo para un despacho. El contenido de su consulta va entonces al proveedor que ha elegido.
- **Un modelo local (Ollama)** funciona sin internet, a coste cero. Requiere una instalación única de Ollama y la descarga del modelo a su ordenador.

Puede combinarlos: un modelo mas económico o local para explorar el expediente, uno mas potente para el escrito final. El consumo y los costes se controlan en **Cuenta → Uso** (con filtro por asunto).

**Asuntos amparados por el secreto profesional y la nube.** En la versión de escritorio usted, letrado en su propia maquina, es el anfitrion de los datos, de modo que su elección de un modelo en la nube es un consentimiento informado. Patron le permite trabajar con cualquier modelo, incluso en los asuntos marcados como reservados. **Cada** flujo de datos hacia el modelo queda registrado en un registro de auditoría inmutable (prueba de diligencia, AI Act art. 12), y los datos personales se enmascaran antes de enviarse. Si el despacho quiere un regimen mas estricto (por ejemplo, los asuntos reservados solo con un modelo local), el administrador puede establecerlo. Por defecto nada le bloquea.

---

## 11. Biblioteca de habilidades

La **Biblioteca de habilidades** es un conjunto de "habilidades" que Patron aplica cuando perfecciona los escritos:

- **Integradas** (siempre activas): **Revisor**, **Abogado del diablo**, **Escribir en lenguaje claro**.
- **Instaladas** (las suyas): puede activar, desactivar e importar etapas adicionales desde un archivo.

Las integradas no requieren ninguna configuración. Trabajan en el panel "Borrador de respuesta".

---

## 12. FAQ

**El asistente no responde, o el chat devuelve un error (sobre todo nada mas instalarse).**
La causa mas comun es la falta de la clave del modelo. Abra **Cuenta → Modelos y claves API** y anada una clave (por ejemplo Libra/Anthropic). La segunda causa es la falta de internet con un modelo en la nube. Compruebe también en **Cuenta → Modelos y claves API** que el modelo seleccionado sea uno del que posee la clave.

**Mis autos del expediente salen a la nube?**
Solo si ha elegido un modelo en la nube; en ese caso el contenido de su consulta va a ese proveedor. Con un modelo local, todo permanece en su ordenador. Los archivos, las bases de datos y el historial de chats se almacenan siempre en local.

**Patron ha escrito algo que no esta en el expediente.**
Mire la etiqueta: el rojo significa no verificado. Los modelos pueden "rellenar los huecos". La etiqueta y su propia verificación son el filtro final, y Patron no lo sustituye.

**La conversión DOCX/PDF no funciona.**
La conversión de documentos requiere LibreOffice en el ordenador. Si falta algo, planteelo al administrador del despacho.

**Como exporto a Word un escrito con comentarios?**
Pida los cambios como revisiones (Paso 4A), acepte los que quiera y descargue el DOCX. En Word vera una revisión a la espera de la aceptación final.

**Patron comprueba si una norma esta vigente?**
Las bases de datos ofrecen un acceso rápido al texto, pero pueden ir por detras del BOE. Verifique el texto vigente en la fuente oficial antes de redactar.

**Patron toma decisiones jurídicas?**
No. La valoracion jurídica, la firma y la responsabilidad profesional son suyas.

---

## 13. Chuleta: prompts listos para usar

**Chat con los autos del expediente**
- "Enumera todos los plazos y las penalizaciones contractuales de este contrato."
- "Que incongruencias hay entre el documento A y el documento B?"
- "Hay un problema de prescripción? Senala las fechas del expediente."

**Jurisprudencia y legislación**
- "Muestra el articulo [X] del [código]."
- "Busca en el BOE la regulacion vigente sobre [tema]."
- Con los conectores polacos activados: "Comprueba [nombre de la sociedad] en el KRS."

**Editar un documento (tras pulsar un archivo DOCX)**
- "Propon un cambio a la cláusula [X]: [lo que quiere], como revisiones."
- "Anade a la cláusula [X] una estipulación [descripción]."
- "Redacta de nuevo la cláusula [X]: [nuevo texto u objetivo]."

**Perfeccionar un escrito**
- El panel "Borrador de respuesta": pegue el texto, elija la perspectiva, después "Perfeccionar el escrito".

---

*Patron es una herramienta que apoya el trabajo del letrado. Cada escrito lo verifica y lo firma el Letrado antes de enviarlo. Este documento refleja el estado de la aplicación a junio de 2026.*
