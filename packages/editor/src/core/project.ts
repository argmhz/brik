import { type PhysicsOptions, type SceneData, newSceneId } from "@brik/runtime";
import { PROJECT_AI_GUIDE } from "./project-guide";
import type { BuildSettings } from "./export";
import type { ProjectFS } from "./fs";

export const PROJECT_FILE = "brik.project.json";

export interface ProjectSettings {
  name: string;
  version: 1;
  /** Scene opened when the editor (and later the game) starts. */
  startScene: string;
  /** Gravity and scale for the physics world. Defaults are used for anything left out. */
  physics?: PhysicsOptions;
  /** Export settings (atlas packing, title). */
  build?: BuildSettings;
}

export async function isProject(fs: ProjectFS): Promise<boolean> {
  return fs.exists(PROJECT_FILE);
}

export async function readProject(fs: ProjectFS): Promise<ProjectSettings> {
  const p = JSON.parse(await fs.readText(PROJECT_FILE)) as Partial<ProjectSettings>;
  return {
    name: p.name ?? fs.name,
    version: 1,
    startScene: p.startScene ?? "scenes/main.scene.json",
    ...(p.physics ? { physics: p.physics } : {}),
    ...(p.build ? { build: p.build } : {}),
  };
}

export async function writeProject(fs: ProjectFS, settings: ProjectSettings): Promise<void> {
  await fs.writeFile(PROJECT_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

/** A scene with just a camera. */
export function defaultScene(): SceneData {
  return {
    version: 1,
    entities: [
      {
        id: newSceneId(),
        components: {
          Name: { value: "Main Camera" },
          Transform2D: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
          Camera2D: {
            zoom: 3,
            viewport: { x: 0, y: 0, w: 1, h: 1 },
            clearColor: { r: 0.08, g: 0.08, b: 0.1, a: 1 },
            clear: true,
            priority: 0,
          },
        },
      },
    ],
  };
}

export function sceneToJson(scene: SceneData): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}

/** Writes the files for a new, empty project. `extras` are added as is (e.g. a sample image). */
export async function createProject(
  fs: ProjectFS,
  name: string,
  extras: Record<string, Uint8Array | string> = {},
): Promise<ProjectSettings> {
  const settings: ProjectSettings = { name, version: 1, startScene: "scenes/main.scene.json" };
  await writeProject(fs, settings);
  await fs.mkdir("assets");
  await fs.writeFile(settings.startScene, sceneToJson(defaultScene()));
  // tells AI coding tools (Claude Code & co.) how a Brik project works
  await fs.writeFile("CLAUDE.md", PROJECT_AI_GUIDE);
  for (const [path, data] of Object.entries(extras)) await fs.writeFile(path, data);
  return settings;
}

const PROJECT_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      experimentalDecorators: true,
      noEmit: true,
      lib: ["ES2022", "DOM"],
      baseUrl: ".",
      paths: { brik: [".brik/types/brik/index.d.ts"], "@brik/*": [".brik/types/@brik/*/index.d.ts"] },
    },
    include: ["**/*.ts"],
    exclude: [".brik"],
  },
  null,
  2,
)}\n`;

/**
 * Writes the engine's type declarations into `.brik/types` and a tsconfig.json
 * (if there is none), so editors like VS Code give autocomplete for "brik".
 */
export async function writeProjectTypes(fs: ProjectFS, types: Record<string, string>): Promise<void> {
  const stamp = String(JSON.stringify(types).length) + Object.keys(types).length;
  const current = await fs.readText(".brik/types/.stamp").catch(() => "");
  if (current !== stamp) {
    for (const [path, content] of Object.entries(types)) await fs.writeFile(`.brik/types/${path}`, content);
    await fs.writeFile(".brik/types/.stamp", stamp);
    await fs.writeFile(".brik/.gitignore", "*\n");
  }
  if (!(await fs.exists("tsconfig.json"))) await fs.writeFile("tsconfig.json", PROJECT_TSCONFIG);
}
