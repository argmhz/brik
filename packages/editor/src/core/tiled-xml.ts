/*
 * Tiled's XML formats (.tmx maps, .tsx tilesets), turned into the same shape
 * as its JSON formats (.tmj, .tsj), so importers.ts handles both. A small XML
 * reader is enough: Tiled writes plain elements and attributes. Works in the
 * browser and in Node alike (no DOMParser).
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside the element (entities decoded, not trimmed). */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

/** Parses an XML document and returns its root element. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  // comments, <?...?>, CDATA, <!DOCTYPE>, closing tags, opening tags with attributes, text
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attr = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = token.exec(src); m; m = token.exec(src)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length < 2 || top.name !== m[2]) throw new Error(`Ugyldig XML: </${m[2]}> passer ikke til <${top.name}>`);
      stack.pop();
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: m[3], attrs: {}, children: [], text: "" };
      for (let a = attr.exec(m[4] ?? ""); a; a = attr.exec(m[4] ?? "")) node.attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  if (stack.length !== 1) throw new Error(`Ugyldig XML: <${stack[stack.length - 1].name}> er ikke lukket`);
  const first = root.children[0];
  if (!first) throw new Error("Ugyldig XML: ingen indhold");
  return first;
}

const child = (n: XmlNode, name: string) => n.children.find((c) => c.name === name);
const children = (n: XmlNode, name: string) => n.children.filter((c) => c.name === name);
const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
const flag = (v: string | undefined) => (v === undefined ? undefined : v === "1" || v === "true");

/** Copies number attributes (when present) onto `out`. */
function numbers(n: XmlNode, names: string[], out: Record<string, unknown>): void {
  for (const k of names) {
    const v = num(n.attrs[k]);
    if (v !== undefined && Number.isFinite(v)) out[k] = v;
  }
}

function properties(n: XmlNode): { name: string; type?: string; value: unknown }[] | undefined {
  const list = child(n, "properties");
  if (!list) return undefined;
  return children(list, "property").map((p) => {
    const type = p.attrs.type ?? "string";
    // long text lives inside the element instead of in `value`
    const raw = p.attrs.value ?? p.text;
    const value = type === "int" || type === "float" ? Number(raw) : type === "bool" ? raw === "true" : raw;
    return { name: p.attrs.name ?? "", type, value };
  });
}

/** A `<data>` element as Tiled's JSON has it: numbers for csv and plain tiles, a string for base64. */
function tileData(data: XmlNode): { data: number[] | string; encoding?: "csv" | "base64"; compression?: string } {
  const encoding = data.attrs.encoding as "csv" | "base64" | undefined;
  if (encoding === "base64") return { data: data.text.replace(/\s+/g, ""), encoding, compression: data.attrs.compression ?? "" };
  if (encoding === "csv") return { data: data.text.split(/[\s,]+/).filter(Boolean).map(Number), encoding };
  // no encoding: one <tile gid="..."/> per cell
  return { data: children(data, "tile").map((t) => Number(t.attrs.gid ?? 0)) };
}

function layerFrom(n: XmlNode): Record<string, unknown> | null {
  const common: Record<string, unknown> = { name: n.attrs.name ?? "" };
  if (n.attrs.visible !== undefined) common.visible = flag(n.attrs.visible);
  numbers(n, ["opacity", "offsetx", "offsety"], common);
  const props = properties(n);
  if (props) common.properties = props;

  if (n.name === "layer") {
    const out: Record<string, unknown> = { ...common, type: "tilelayer" };
    numbers(n, ["width", "height"], out);
    const data = child(n, "data");
    if (data) {
      const chunks = children(data, "chunk");
      if (chunks.length > 0) {
        out.chunks = chunks.map((c) => {
          const d = tileData({ ...c, attrs: { ...c.attrs, encoding: data.attrs.encoding ?? "", compression: data.attrs.compression ?? "" } });
          return { x: Number(c.attrs.x), y: Number(c.attrs.y), width: Number(c.attrs.width), height: Number(c.attrs.height), data: d.data };
        });
        if (data.attrs.encoding) out.encoding = data.attrs.encoding;
        if (data.attrs.compression) out.compression = data.attrs.compression;
      } else Object.assign(out, tileData(data));
    }
    return out;
  }
  if (n.name === "objectgroup") {
    return {
      ...common,
      type: "objectgroup",
      objects: children(n, "object").map((o) => {
        const obj: Record<string, unknown> = { name: o.attrs.name ?? "" };
        if (o.attrs.type ?? o.attrs.class) obj.type = o.attrs.type ?? o.attrs.class;
        numbers(o, ["id", "x", "y", "width", "height", "rotation", "gid"], obj);
        if (child(o, "point")) obj.point = true;
        if (child(o, "ellipse")) obj.ellipse = true;
        const p = properties(o);
        if (p) obj.properties = p;
        return obj;
      }),
    };
  }
  if (n.name === "group") return { ...common, type: "group", layers: layersOf(n) };
  if (n.name === "imagelayer") return { ...common, type: "imagelayer" };
  return null;
}

function layersOf(n: XmlNode): Record<string, unknown>[] {
  return n.children.map(layerFrom).filter((l): l is Record<string, unknown> => l !== null);
}

/** A `<tileset>` element (embedded in a map, or the root of a .tsx file) as Tiled's JSON has it. */
function tilesetFrom(n: XmlNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (n.attrs.name) out.name = n.attrs.name;
  if (n.attrs.source) out.source = n.attrs.source;
  numbers(n, ["firstgid", "tilewidth", "tileheight", "tilecount", "columns", "margin", "spacing"], out);
  const image = child(n, "image");
  if (image) {
    if (image.attrs.source) out.image = image.attrs.source;
    if (image.attrs.width) out.imagewidth = Number(image.attrs.width);
    if (image.attrs.height) out.imageheight = Number(image.attrs.height);
  }
  // columns is optional in old files: work it out from the image
  if (out.columns === undefined && typeof out.imagewidth === "number" && typeof out.tilewidth === "number") {
    const margin = (out.margin as number | undefined) ?? 0;
    const spacing = (out.spacing as number | undefined) ?? 0;
    out.columns = Math.floor((out.imagewidth - 2 * margin + spacing) / (out.tilewidth + spacing));
  }
  return out;
}

/** A .tmx map as Tiled's JSON map format (.tmj). */
export function tmxToJson(text: string): Record<string, unknown> {
  const map = parseXml(text);
  if (map.name !== "map") throw new Error("Ikke et Tiled-kort (.tmx)");
  const out: Record<string, unknown> = { type: "map" };
  numbers(map, ["width", "height", "tilewidth", "tileheight"], out);
  out.infinite = flag(map.attrs.infinite) ?? false;
  const props = properties(map);
  if (props) out.properties = props;
  out.tilesets = children(map, "tileset").map(tilesetFrom);
  out.layers = layersOf(map);
  return out;
}

/** A .tsx tileset as Tiled's JSON tileset format (.tsj). */
export function tsxToJson(text: string): Record<string, unknown> {
  const root = parseXml(text);
  if (root.name !== "tileset") throw new Error("Ikke et Tiled-tileset (.tsx)");
  return { type: "tileset", ...tilesetFrom(root) };
}
