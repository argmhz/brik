#!/usr/bin/env node
// Brik MCP server: lets AI clients (Claude Code, Claude Desktop, ...) work in a
// running Brik editor. The client talks MCP over stdio; the editor connects to
// this process over a local WebSocket when the user switches "AI" on.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { EditorBridge } from "./bridge.mjs";

const INSTRUCTIONS = `Brik is a web-first 2D game engine (ECS, TypeScript scripts). These tools work in the Brik editor the user has open, live: they see every change, and each change can be undone with Ctrl+Z (or the undo tool).

How to work:
- Start with project_info and get_hierarchy. Entities are addressed by their id (a string), not by name; find_entities looks them up.
- Before adding or editing a component, call list_components (with a name) to see its fields, kinds, defaults and allowed values. Field values use the saved scene format: vec2 {x,y}, color {r,g,b,a} 0..1, angles in radians, entity fields as an entity id or null.
- Coordinates are world units (pixels by default) with y pointing UP. The default camera is at (0,0).
- Gravity and collisions: a falling object needs RigidBody2D (type "dynamic") plus Collider2D; static ground needs only Collider2D. Platformer characters use RigidBody2D "kinematic" + CharacterController2D + Collider2D and are moved with this.moveCharacter(dx, dy) in a script.
- Gameplay code goes in Behaviour classes: write_script("scripts/Name.ts", ...) compiles at once and returns errors; then attach_script and set_script_field. Scripts import from "brik", e.g. import { Behaviour, expose, Velocity2D } from "brik". Hooks: onStart, onUpdate(dt), onFixedUpdate(dt), onCollisionEnter(other), onTriggerEnter(other), onClick, ...
- Art: draw_sprites makes pixel-art PNGs from text rows, create_animation turns sprites into clips. Levels: read_tiles shows a TileMap as text, paint_tiles edits it.
- Test your work: play, step (a number of frames, optionally holding keys like ArrowRight or pressing Space, or moving the mouse), click (UI buttons or points in the world), inspect_entity (shows live script values while playing), screenshot, get_console, then stop. The scene can't be edited while the game runs.
- The scene is not saved automatically. Call save_scene when the user wants to keep the result.`;

const bridge = new EditorBridge({ port: Number(process.env.BRIK_MCP_PORT) || 5181 });

const server = new McpServer({ name: "brik", version: "0.1.0" }, { instructions: INSTRUCTIONS });

const id = z.string().describe("Entity id from get_hierarchy, find_entities or create_entity");
const values = z.record(z.string(), z.any());

/** Registers a tool that forwards to the editor. */
function tool(name, description, inputSchema, opts = {}) {
  server.registerTool(
    name,
    { description, inputSchema, annotations: { readOnlyHint: !!opts.readOnly, destructiveHint: !!opts.destructive } },
    async (args) => {
      try {
        const result = await bridge.call(name, args ?? {});
        if (opts.image && result?.data) {
          return { content: [{ type: "image", data: result.data, mimeType: result.mimeType ?? "image/png" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 1) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
      }
    },
  );
}

// ---------------------------------------------------------------- looking

tool("project_info", "Project name, open scene, play mode, script status and whether there are unsaved changes.", {}, { readOnly: true });

tool(
  "get_hierarchy",
  "The scene's entity tree: id, name and component names of every entity.",
  { depth: z.number().int().min(0).optional().describe("How many levels of children to include (default 6)") },
  { readOnly: true },
);

tool(
  "find_entities",
  "Finds entities by (part of) their name, by a component they have, or by tag.",
  { name: z.string().optional(), component: z.string().optional(), tag: z.string().optional() },
  { readOnly: true },
);

tool(
  "inspect_entity",
  "All component values of one entity, its scripts with their exposed fields (and live values while playing), parent, children and prefab link.",
  { id },
  { readOnly: true },
);

tool(
  "list_components",
  "Component types with their fields, kinds, defaults and allowed values. Pass a name to get just one.",
  { name: z.string().optional() },
  { readOnly: true },
);

tool(
  "list_assets",
  "Textures (with their sprite ids), animation clips, prefabs, sounds, scenes and script files.",
  { kind: z.enum(["textures", "clips", "prefabs", "sounds", "scenes", "scripts"]).optional() },
  { readOnly: true },
);

tool("list_scripts", "Compiled Behaviour classes with their @expose fields.", {}, { readOnly: true });

tool("read_file", "Reads a text file in the project (a script, scene or prefab).", { path: z.string() }, { readOnly: true });

tool(
  "get_console",
  "Recent messages from the editor console: script errors, logs from scripts, AI actions. The console is cleared when play starts.",
  { limit: z.number().int().min(1).max(500).optional(), level: z.enum(["log", "info", "warn", "error"]).optional() },
  { readOnly: true },
);

tool(
  "screenshot",
  'A picture of the scene view (with selection and gizmos) or the game view (through the game camera, with UI). Use "game" while playing.',
  { view: z.enum(["scene", "game"]).optional() },
  { readOnly: true, image: true },
);

// ---------------------------------------------------------------- editing

tool(
  "create_entity",
  "Creates an entity and selects it. `kind` gives a starting shape: empty, rect, circle, sprite, animated, camera, text, sound, tilemap, particles, ui-canvas, ui-image, ui-text, ui-button. `components` adds or overrides components, e.g. { RigidBody2D: { type: 'dynamic' }, Collider2D: { size: { x: 32, y: 32 } } }.",
  {
    kind: z.string().optional(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    parent: id.optional().describe("Parent entity id"),
    components: z.record(z.string(), values).optional(),
  },
);

tool(
  "set_fields",
  "Sets some fields of a component the entity has. Partial values are fine, e.g. { position: { y: 40 } }.",
  { id, component: z.string(), values },
);

tool("add_component", "Adds a component (and the components it requires), optionally with values.", {
  id,
  component: z.string(),
  values: values.optional(),
});

tool("remove_component", "Removes a component from an entity.", { id, component: z.string() }, { destructive: true });

tool("delete_entities", "Deletes entities and their children.", { ids: z.array(z.string()) }, { destructive: true });

tool("reparent", "Moves entities under a new parent (null for the top level), optionally at a child index.", {
  ids: z.array(z.string()),
  parent: z.string().nullable().optional(),
  index: z.number().int().optional(),
});

tool("select", "Selects entities in the editor, so the user sees what you mean.", { ids: z.array(z.string()) });

tool("undo", "Undoes the last change in the editor.", {}, { destructive: true });

// ---------------------------------------------------------------- art and tiles

tool(
  "draw_sprites",
  'Draws pixel art into a PNG in the project (overwrites it if it exists, keeping its guid). Each sprite is a list of rows; each character is a pixel looked up in `palette`, and "." or space is transparent. All sprites must have the same size and are laid out side by side. Returns the texture guid and sprite names, ready for Sprite { sprite: { texture: guid, id: name } } or create_animation.',
  {
    path: z.string().describe("e.g. assets/slime.png"),
    palette: z.record(z.string(), z.string().nullable()).describe('Character to colour, e.g. { "g": "#3fa34d", "k": "#1b1b1b", "w": "#ffffffcc" }'),
    sprites: z.record(z.string(), z.array(z.string())).describe('Sprite name to pixel rows (top row first), e.g. { "slime_0": ["..gggg..", ".gkggkg.", "gggggggg"] }'),
    pivot: z.array(z.number()).length(2).optional().describe("Pivot of every sprite, 0..1 from the bottom-left (default [0.5, 0.5])"),
    scale: z.number().int().min(1).max(8).optional().describe("Each character becomes scale x scale pixels (default 1)"),
  },
);

tool(
  "create_animation",
  "Creates or replaces an animation clip (<name>.anim.json) from sprites of one texture. Scripts play it with this.playAnimation(name); a SpriteAnimator plays it with { clip: guid }.",
  {
    path: z.string().describe("e.g. assets/slime_walk.anim.json (the file name is the clip name)"),
    texture: z.string().describe("Texture path, guid or name"),
    frames: z.array(z.string()).describe("Sprite names (or ids) in order"),
    fps: z.number().positive().optional().describe("Frames per second (default 8)"),
    mode: z.enum(["loop", "once", "pingpong"]).optional(),
    events: z.array(z.object({ frame: z.number().int(), name: z.string() })).optional().describe("Calls onAnimationEvent(name) in scripts when the frame shows"),
  },
);

tool(
  "read_tiles",
  "Shows a TileMap as text rows (top row first) with a legend, so you can see the level layout.",
  { id },
  { readOnly: true },
);

tool(
  "paint_tiles",
  'Paints a TileMap (one undo step). `rects` fill rectangles of cells with a tile name (null erases). `map` paints text rows: its x, y is the cell of the first character of the top row, rows go downwards (y decreases), and each character is looked up in `legend` (characters not in the legend are left as they are). Cell (x, y) covers world x*tileSize .. (x+1)*tileSize. TileMapCollider updates automatically.',
  {
    id,
    rects: z
      .array(z.object({ x0: z.number().int(), y0: z.number().int(), x1: z.number().int(), y1: z.number().int(), tile: z.string().nullable() }))
      .optional(),
    map: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        rows: z.array(z.string()),
        legend: z.record(z.string(), z.string().nullable()).describe('e.g. { "G": "grass", "d": "dirt", "_": null }'),
      })
      .optional(),
  },
);

// ---------------------------------------------------------------- scripts

tool(
  "write_script",
  "Writes a TypeScript file in scripts/ and compiles all scripts. Returns compile errors, or the Behaviour ids it defines. Write the whole file.",
  { path: z.string().describe("e.g. scripts/Mover.ts"), content: z.string() },
);

tool("attach_script", "Puts a Behaviour on an entity. `script` is the class name or a full id like scripts/Mover.ts#Mover.", {
  id,
  script: z.string(),
});

tool("detach_script", "Removes a Behaviour from an entity.", { id, script: z.string() }, { destructive: true });

tool(
  "set_script_field",
  "Sets an @expose field of a script on one entity. Entity fields take an entity id. Leave out value to reset to the default.",
  { id, script: z.string(), key: z.string(), value: z.any().optional() },
);

// ---------------------------------------------------------------- prefabs and scenes

tool("place_prefab", "Places an instance of a prefab (by name or guid).", {
  prefab: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  parent: z.string().optional(),
});

tool("create_prefab", "Saves an entity and its children as a new prefab file and links the entity to it.", { id });

tool("apply_prefab", "Writes an instance's changes back to its prefab and updates all instances.", { id });

tool("save_scene", "Saves the open scene, or saves it under a new path like scenes/level2.", { path: z.string().optional() });

tool("open_scene", "Opens another scene. Refuses when there are unsaved changes unless discardChanges is true.", {
  path: z.string(),
  discardChanges: z.boolean().optional(),
});

// ---------------------------------------------------------------- play

tool("play", "Starts the game in the editor (the scene is restored on stop).", {});
tool("pause", "Pauses the running game.", {});
tool(
  "step",
  'Pauses and advances the game a number of frames (1/60 s each, max 600), optionally with keys held down, so you can test controls. Default bindings: axis "horizontal" = ArrowLeft/KeyA and ArrowRight/KeyD, "vertical" = ArrowDown/KeyS and ArrowUp/KeyW, action "jump" = Space, "fire" = Mouse0.',
  {
    frames: z.number().int().min(1).max(600).optional(),
    hold: z.array(z.string()).optional().describe('Key codes held during all these frames, e.g. ["ArrowRight"]'),
    press: z.array(z.string()).optional().describe('Key codes pressed in the first frame and released after it, e.g. ["Space"]'),
    mouse: z
      .object({ entity: z.string().optional(), x: z.number().optional(), y: z.number().optional() })
      .optional()
      .describe('Moves the mouse first: { entity: "<id>" } aims at a UI element or an entity, { x, y } at a point in world units. Use with hold/press "Mouse0" to shoot or drag.'),
  },
);
tool(
  "click",
  "Clicks in the running game: moves the mouse to a UI element (entity id, e.g. a UIButton) or a world point (x, y in world units), presses and releases the button, and runs 4 frames. Returns the button under the mouse and which UIButtons sent a click, so you can see if you hit.",
  {
    entity: z.string().optional().describe("A UI element or entity id to click on"),
    x: z.number().optional(),
    y: z.number().optional(),
    button: z.number().int().min(0).max(2).optional().describe("0 left (default), 1 middle, 2 right"),
  },
);
tool("stop", "Stops the game and restores the scene as it was before play.", {});

// ---------------------------------------------------------------- start

await bridge.start();
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);
