# 1. Visión General del Proyecto

## 1.1 Problema
Azure DevOps (ADO) carece de una interfaz ágil y visual para la secuenciación de micro-tareas y la asignación de dependencias temporales a nivel de desarrollador. El registro manual de Start Date y Target Date de forma masiva en la interfaz web de ADO genera fricción y ineficiencia operativa para los líderes de equipo.

## 1.2 Solución
Una aplicación de escritorio local ("Offline Planner") que permite importar un archivo Excel/CSV exportado desde una Query de ADO. La aplicación agrupa las tareas por Historia de Usuario y las proyecta en un cronograma visual interactivo (Gantt/Timeline) organizado por desarrollador. Permite la ordenación mediante arrastrar y soltar (drag-and-drop), calcula cascadas de fechas automáticamente y exporta un archivo Excel optimizado para la re-importación masiva en Azure DevOps.

## 1.3 Objetivos Clave
- Aislamiento: Cero integraciones directas por API/Webhooks con el servidor de ADO para evitar afectar a otros equipos.
- Fluidez: Modificación de fechas y responsables en un entorno puramente visual con interacción de < 100ms.
- Fidelidad de Datos: Garantizar que el ID único de ADO permanezca intacto durante todo el ciclo de vida del dato local.


# 2. Stack Tecnológico
- Frontend Framework: Vue.js (TypeScript mandatorio para asegurar la tipificación de los datos de ADO).
- Desktop Runtime: Tauri 
- Estilos: Tailwind CSS (diseño responsivo y ágil, preferiblemente con un look & feel oscuro/limpio tipo Libadwaita).
- Manejo de Archivos: SheetJS (xlsx) para el parsing bidireccional de Excel/CSV de forma local.
- Motor de Cronograma: Frappe Gantt o un desarrollo propio basado en CSS Grid / Flexbox para control total de las dependencias.


# 3. Especificaciones de Datos (Data Schema)

## 3.1 Estructura del Archivo de Entrada (ADO Export)
La aplicación debe ser capaz de procesar un archivo con la estructura estándar de una Query de ADO: 
Columna en Excel,Tipo de Dato,Requerido,Descripción
ID,ID (Integer),Sí,Identificador único del Work Item en ADO.
Work Item Type,String,Sí,Filtrar por Task o User Story.
Title,String,Sí,Título de la tarea o de la Historia de Usuario.
Assigned To,String (Email/Nombre),No,Desarrollador asignado actualmente.
Start Date,Date (YYYY-MM-DD),No,Fecha de inicio actual en ADO.
Target Date,Date (YYYY-MM-DD),No,Fecha de fin actual en ADO.
Parent,ID (Integer),Sí,ID de la Historia de Usuario a la que pertenece la Task.

## 3.2 Estado Interno de la Aplicación (Store)
```
interface Task {
  id: number;
  parentId: number;
  title: string;
  assignedTo: string;
  startDate: string | null; // ISO String YYYY-MM-DD
  endDate: string | null;   // ISO String YYYY-MM-DD
  durationDays: number;
  sequenceOrder: number;    // Orden secuencial dentro del desarrollador
}

interface UserStory {
  id: number;
  title: string;
  tasks: Task[];
}

interface DeveloperLane {
  developerName: string;
  tasks: Task[];
}
```


# 4. Requerimientos Funcionales (FR)

## Epic 1: Gestión de Archivos (I/O)

- FR-1.1: Pantalla inicial con zona de arrastre (Dropzone) para archivos .xlsx o .csv.
- FR-1.2: Validación de columnas críticas (ID, Parent). Si faltan, mostrar alerta clara de error de mapeo.
- FR-1.3: Exportación en un clic que genere un archivo Excel formateado únicamente con las columnas modificadas necesarias para la carga masiva en ADO: ID, Assigned To, Start Date, Target Date.

## Epic 2: Visualización y Agrupación
- FR-2.1: Vista por Desarrollador (Swimlanes): El eje vertical muestra los nombres de los desarrolladores. El eje horizontal muestra la línea de tiempo (días/semanas).
- FR-2.2: Agrupación Visual por Contexto: Cada tarjeta de tarea dentro del cronograma debe mostrar visualmente a qué Historia de Usuario pertenece (código de colores o etiqueta de Parent ID).

## Epic 3: Motor de Secuenciación (Drag-and-Drop)
- FR-3.1: El usuario puede arrastrar una tarea horizontalmente para cambiar su fecha de inicio y fin (manteniendo la duración).
- FR-3.2: El usuario puede estirar los bordes de la tarjeta de tarea para aumentar/disminuir los días de duración.
- FR-3.3: Modo Cascada (Secuencialidad): Switch opcional. Al estar activo, si la Tarea A se mueve o se alarga, la Tarea B (siguiente en el orden del desarrollador) desplaza su fecha de inicio automáticamente para empezar al día siguiente hábil de la finalización de la Tarea A.
- FR-3.4: El usuario puede arrastrar una tarea verticalmente a otra fila para reasignarla a otro desarrollador de forma inmediata.


# 5. Requerimientos No Funcionales (NFR)
- NFR-5.1 (Privacidad y Seguridad): Ningún dato se envía a servidores externos. Todo el procesamiento de datos ocurre en la memoria local de la máquina del usuario.
- NFR-5.2 (Rendimiento): Soportar la carga de hasta 500 tareas simultáneas en pantalla sin degradación de la tasa de frames (>60 FPS durante el arrastre).
- NFR-5.3 (Persistencia Temporal): Guardar el estado actual en el localStorage de la aplicación local para evitar la pérdida de progreso si la aplicación se cierra accidentalmente antes de exportar.


# 6. Diseño de Interfaz de Usuario (UI) y Distribución
La pantalla principal se divide en tres secciones clave utilizando un layout de tres paneles:

+---------------------------------------------------------------------------------------+
|  [ Icon ]  ADO Sequential Task Planner               [ Importar ]  [ Exportar Excel ] |
+---------------------------------------------------------------------------------------+
| Filtros: [ Opciones de Cascada: ON ] [ Vista: Semanal ] [ Buscar Tarea...          ] |
+---------------------------------------------------------------------------------------+
| DESARROLLADOR  | LÍNEA DE TIEMPO (GANTT INTERACTIVO)                                  |
+----------------+----------------------------------------------------------------------+
| Dev Juan       | [+-- H.U. 1024: Crear LWC Base ------+]                             |
|                |                                       [+-- H.U. 1024: Test Unit ----+]|
+----------------+----------------------------------------------------------------------+
| Dev Maria      |        [+-- H.U. 1025: Apex Controller -----+]                       |
|                |                                             [+-- H.U. 1026: UI ----+]|
+----------------+----------------------------------------------------------------------+
| Sin Asignar    | [+-- Tarea Huérfana 1 --+]                                           |
+---------------------------------------------------------------------------------------+


# 7. Fases de Implementación (Milestones)

1. Fase 1 (Core & Parser): Crear la base del proyecto en Tauri/Electron. Desarrollar la lógica con SheetJS para leer el archivo exportado de ADO, estructurar el JSON interno en memoria y validar que la exportación vuelva a generar el formato que ADO requiere para su actualización en masa.

2. Fase 2 (UI & Grid): Construir la interfaz de filas por desarrollador y renderizar las tareas como bloques sobre un eje de tiempo estático.

3. Fase 3 (Interactividad): Implementar la librería de Drag-and-Drop. Habilitar el movimiento horizontal (fechas) y vertical (asignaciones).

4. Fase 4 (Lógica de Cascada): Desarrollar el algoritmo de empuje automático de fechas secuenciales en base al orden de las tarjetas en la fila de cada desarrollador. Re-calcular fines de semana (para ignorar días no laborables).