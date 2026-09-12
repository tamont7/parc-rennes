import type { Tree } from "./data";
import { TreeFruit, fruitForTaxon } from "./TreeFruit";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { additionalFoliage } from "./additionalFoliage";

export type Foliage = { sourceUrl?: string; sourceTaxon?: string; fill?: string; stroke?: string; label: string; description: string; outline?: string; veins?: string; veinStroke?: string; veinWidth?: number; midrib?: string; midribStroke?: string; kind?: "flat" | "cedar" | "giant" | "compound" | "horsechestnut" | "palm" | "yew" | "fir" | "irishYew" | "ash" | "cypressSpray" | "lawsonSpray" | "zebrina" | "pinsapo" | "bipinnate" | "woodlandBuckeye" };
const beech: Foliage = {
  label: "Feuille de hêtre", description: "Feuille ovale verte, nervures latérales bien marquées.", fill: "#668b3e", stroke: "#304d22",
  outline: "M60 100C36 94 22 78 26 60C23 44 42 27 60 12C78 28 95 43 92 60C98 78 81 94 60 100Z",
  veins: "M60 113V17M60 92 35 81M60 80 29 66M60 66 30 50M60 52 39 36M60 38 48 25M60 92 86 81M60 80 90 66M60 66 87 50M60 52 80 36M60 38 72 25",
};
const oak: Foliage = {
  label: "Feuille de chêne", description: "Feuille vert foncé à lobes arrondis.", fill: "#52763c", stroke: "#294725",
  outline: "M60 101C44 106 35 96 43 88C19 91 15 75 34 69C12 64 18 48 37 51C24 34 34 25 47 35C44 8 75 8 73 34C92 23 101 39 84 51C108 48 107 68 87 71C105 81 96 95 77 88C86 101 73 106 60 101Z",
  veins: "M60 114V24M60 88 32 81M60 70 29 59M60 50 39 36M60 88 87 82M60 70 95 59M60 50 83 37",
};
const pointedOak: Foliage = {
  fill: "#4e7339", stroke: "#294725", label: "Feuille de chêne à lobes pointus", description: "Lobes découpés et pointus ; forme variable selon l’espèce.",
  outline: "M60 103 36 96 40 85 17 79 31 67 13 51 37 55 29 32 48 40 60 12 71 40 92 30 84 54 107 49 90 68 104 82 80 85 85 98Z",
  veins: "M60 114V21M60 88 23 79M60 67 21 54M60 49 33 35M60 88 98 81M60 67 100 54M60 49 87 35",
};
const evergreenOak: Foliage = {
  fill: "#3f6040", stroke: "#243e29", label: "Feuille de chêne persistant", description: "Feuille coriace, bord entier ou denté selon les feuilles.",
  outline: "M60 102 44 95 42 84 31 79 36 68 29 58 38 50 35 39 46 35 60 15 73 33 85 38 82 49 91 57 85 68 89 79 78 85 77 95Z",
  veins: "M60 114V23M60 87 42 77M60 68 40 56M60 48 45 38M60 87 79 77M60 68 81 56M60 48 76 38",
};
const ginkgo: Foliage = {
  fill: "#82a94d", stroke: "#3e652e", label: "Feuille de ginkgo", description: "Feuille en éventail, souvent échancrée au milieu.",
  outline: "M59 95Q29 82 12 46L17 34 28 27 41 24 52 28 60 42 68 28 79 24 92 27 104 35 109 46Q93 81 62 95Z",
  veins: "M60 115V94M60 94Q31 57 19 39M60 94Q44 48 32 30M60 94 49 32M60 94 60 46M60 94 73 32M60 94Q78 49 88 31M60 94Q92 53 103 40",
};

// Curated scientific names only; see FOLIAGE-SOURCES.md for provenance.
const osu = "https://landscapeplants.oregonstate.edu/plants/";
function sourced(taxon: string, drawing: Foliage, slug = taxon.toLowerCase().replace(/ /g, "-")): Foliage {
  return { ...drawing, sourceTaxon: taxon, sourceUrl: `${osu}${slug}` };
}
const cedar: Foliage = { kind: "cedar", label: "Aiguilles de cèdre", description: "Aiguilles vertes réunies en bouquets sur les rameaux courts.", fill: "#597858", stroke: "#38573d" };
const foliageByTaxon: Record<string, Foliage> = {
  ...additionalFoliage,
  "fagus sylvatica": sourced("Fagus sylvatica", beech),
  "fagus sylvatica pendula": sourced("Fagus sylvatica f. pendula", beech, "fagus-sylvatica-f-pendula"),
  "fagus sylvatica purpurea": sourced("Fagus sylvatica 'Purpurea'", { ...beech, label: "Feuille de hêtre pourpre", fill: "#784453", stroke: "#482c3c", description: "Feuille pourpre au printemps, pouvant verdir en cours de saison." }, "fagus-sylvatica-purpurea"),
  "fagus sylvatica laciniata": {
    fill: "#668b3e", stroke: "#304d22", label: "Feuille de hêtre lacinié", description: "Exemple de feuille découpée ; les bords sont très variables.",
    outline: "M60 102 46 94 52 87 34 81 46 75 29 66 43 61 30 49 46 48 38 34 52 37 60 13 67 36 81 31 75 47 92 45 79 60 94 65 80 75 88 81 70 87 75 94Z",
    veins: "M60 113V20M60 88 42 80M60 72 36 65M60 55 38 48M60 88 82 80M60 72 88 65M60 55 85 48",
    sourceTaxon: "Fagus sylvatica 'Laciniata'",
    sourceUrl: "https://www.rhs.org.uk/plants/32829/fagus-sylvatica-laciniata/details",
  },
  "quercus robur": sourced("Quercus robur", oak),
  "quercus palustris": sourced("Quercus palustris", {
    ...pointedOak,
    outline: "M60 104 35 91 23 76 44 82Q55 76 43 65L14 59 25 49 17 36 42 50Q55 53 51 39L45 28 54 29 60 12 67 29 77 25 69 43Q66 56 80 49L105 35 96 50 108 58 82 65Q65 76 78 83L100 75 88 92Z",
  }),
  "quercus cerris": sourced("Quercus cerris", {
    ...pointedOak,
    veins: "M60 113V20M60 88 39 80M60 70 36 59M60 49 43 34M60 88 83 79M60 70 88 59M60 49 76 33",
    outline: "M60 102 43 95 46 85 31 80 40 71 28 60 38 56 32 43 45 44 42 30 53 33 60 12 70 31 80 27 77 43 88 39 82 55 94 59 81 71 90 79 75 86 79 95Z",
  }),
  "quercus ilex": sourced("Quercus ilex", {
    label: "Feuille de chêne vert",
    description: "Exemple de feuille ovale à lancéolée, à bord entier. L’espèce peut aussi porter des feuilles dentées.",
    // Outline and colours follow the user's OSU photo quilex910.jpg,
    // rotated so the petiole remains at the bottom like the other sketches.
    fill: "#4e6d69", stroke: "#829785",
    outline: "M59 111C46 112 41 102 40 91Q40 85 39 79Q38 72 40 67Q42 62 45 57Q48 52 49 47Q50 43 53 39Q55 35 56 30Q58 21 62 11C68 20 73 34 77 47Q82 61 81 75Q82 87 78 98C75 107 68 112 59 111Z",
    veins: "M59 99Q49 93 42 88M59 86Q47 78 41 70M60 72Q48 63 46 56M60 58Q53 50 51 44M60 44Q57 37 56 32M59 98Q70 92 78 89M59 84Q72 77 80 68M60 71Q71 63 77 54M60 57Q69 48 73 42M60 44Q66 37 68 31",
    veinStroke: "#94a38a", veinWidth: 0.55,
    midrib: "M59 120L59 109Q58 84 60 61Q59 34 62 11", midribStroke: "#d7cf9f",
  }),
  "quercus suber": sourced("Quercus suber", { ...evergreenOak,
    outline: "M60 102Q45 102 38 91L39 84 31 77 35 68 30 59 36 51 35 42 45 37 60 15 75 36 84 41 83 51 90 59 85 68 88 77 80 85 82 91Q74 102 60 102Z",
  }),
  "ginkgo biloba": sourced("Ginkgo biloba", ginkgo),
  "cedrus atlantica": sourced("Cedrus atlantica", cedar),
  "cedrus atlantica glauca": sourced("Cedrus atlantica 'Glauca'", { ...cedar, fill: "#71999c", stroke: "#507d84", description: "Aiguilles bleu-vert argenté, réunies en bouquets." }, "cedrus-atlantica-glauca"),
  "cedrus libani": sourced("Cedrus libani", cedar),
  "taxodium distichum": sourced("Taxodium distichum", { kind: "flat", fill: "#80a14e", stroke: "#4c6b32", label: "Rameau de cyprès chauve", description: "Aiguilles fines et souples, caduques." }),
  "sequoia sempervirens": sourced("Sequoia sempervirens", { kind: "flat", fill: "#47734b", stroke: "#2c4e35", label: "Rameau de séquoia toujours vert", description: "Exemple de rameau à feuilles plates." }),
  "sequoiadendron giganteum": sourced("Sequoiadendron giganteum", { kind: "giant", fill: "#668d7e", stroke: "#385f50", label: "Rameau de séquoia géant", description: "Feuilles courtes, pointues et imbriquées autour du rameau." }),
};

export function foliageForTree(tree: Pick<Tree, "scientificName">): Foliage | null {
  let taxon = tree.scientificName?.trim().toLowerCase().replace(/[’']/g, "").replace(/×/g, "x").replace(/\s+/g, " ") ?? "";
  // Explicit spelling correction in the municipal dataset; source data stays intact.
  if (taxon === "ilex aquifolium j.c. van tol") taxon = "ilex aquifolium j.c van tol";
  if (taxon === "chamaecyparis lawsoniana alumii") taxon = "chamaecyparis lawsoniana allumii";
  if (taxon === "albizia julibrissin") taxon = "albizzia julibrissin";
  if (taxon === "cedrus libanii") taxon = "cedrus libani";
  return Object.prototype.hasOwnProperty.call(foliageByTaxon, taxon) ? foliageByTaxon[taxon] : null;
}

function Branch({ kind, fill }: { kind: Foliage["kind"]; fill?: string }) {
  if (kind === "pinsapo") return <>
    <path d="M60 117V14" stroke="#877252" strokeWidth="3" />
    {Array.from({length: 16}, (_, i) => [-1,0,1].map(side => <g key={`${i}-${side}`} transform={`translate(60 ${24+i*5.3}) rotate(${side*83+(i%2 ? 10 : -10)})`}>
      <path d="M-1 0-2-11 0-19 2-11 1 0Z" fill={fill} strokeWidth=".6" />
    </g>))}
  </>;
  if (kind === "bipinnate") return <>
    <path d="M60 119V30" stroke="#7e8452" strokeWidth="1.2" />
    {[{y:30,n:7,a:35},{y:46,n:9,a:58},{y:62,n:11,a:64},{y:78,n:12,a:68},{y:94,n:11,a:72},{y:108,n:9,a:76}].flatMap(({y,n,a}) => [-1,1].map(side => <g key={`${y}-${side}`} transform={`translate(60 ${y}) rotate(${side*a})`}>
      <path d={`M0 0V${-n*3.2-2}`} stroke="#7e8452" strokeWidth=".65" />
      {Array.from({length:n},(_,j) => {
        const d = (j+1)*3.2;
        const size = j === n-1 ? .7 : j === 0 ? .8 : 1;
        return <g key={j} transform={`translate(0 ${-d}) scale(${size})`}>
          <path d="M0 0C-2 .4-5-1-5-2.5C-4-4-1-2 0 0ZM0 0C2 .4 5-1 5-2.5C4-4 1-2 0 0Z" fill={fill} strokeWidth=".3" />
        </g>;
      })}
    </g>))}
  </>;
  if (kind === "ash") return <>
    <path d="M60 119V25" stroke="#7d7950" strokeWidth="2" />
    {[{x:60,y:42,a:0}, ...[58,80,102].flatMap(y => [{x:60,y,a:-57},{x:60,y,a:57}])].map(({x,y,a}) => <g key={`${y}-${a}`} transform={`translate(${x} ${y}) rotate(${a})`}>
      <path d="M0 0Q-11-6-12-15L-14-18-12-21-13-24-10-27-10-30 0-41 10-30 10-27 13-24 12-21 14-18 12-15Q11-6 0 0Z" fill={fill} />
      <path d="M0 0V-35M0-10-9-18M0-20-8-28M0-10 9-18M0-20 8-28" stroke="#9aae6e" strokeWidth=".7" />
    </g>)}
  </>;
  if (kind === "cypressSpray" || kind === "lawsonSpray" || kind === "zebrina") {
    const flat = kind !== "cypressSpray";
    return <>
      <path d="M60 118V17" stroke="#827052" strokeWidth="2" />
      {[{x:60,y:99,a:0,n:17}, ...[56,78,100].flatMap(y => [{x:60,y,a:flat ? -55 : -27,n:7},{x:60,y:y-5,a:flat ? 55 : 27,n:7}])].map(({x,y,a,n}) => <g key={`${y}-${a}`} transform={`translate(${x} ${y}) rotate(${a})`}>
        <path d={`M0 3V${-(n-1)*5}`} stroke={fill} strokeWidth="5" />
        {Array.from({length:n},(_,i) => <path key={i} d={i === n-1 ? `M0 ${-i*5}q-4-3 0-9q4 6 0 9Z` : `M0 ${-i*5}q-5-2-4-8l4 4 4-4q1 6-4 8Z`} fill={kind === "zebrina" && i % 5 < 2 ? "#d2cb7c" : fill} strokeWidth=".6" />)}
        {flat && [-1,1].map(side => <g key={side} transform={`translate(0 -17) rotate(${side*38})`}>
          {[0,1,2,3].map(i => <path key={i} d={`M0 ${-i*5}l-4-8 4 3 4-3Z`} fill={kind === "zebrina" && i < 2 ? "#d2cb7c" : fill} strokeWidth=".6" />)}
        </g>)}
      </g>)}
    </>;
  }
  if (kind === "irishYew") return <>
    <path d="M60 118V14" stroke="#85704e" strokeWidth="2" />
    {Array.from({length:14},(_,i) => [-1,0,1].map(side => <g key={`${i}-${side}`} transform={`translate(${60+side*2} ${29+i*6}) rotate(${side*43+(i%2 ? 6 : -6)})`}>
      <path d="M0 0Q-4-14 0-25Q4-14 0 0Z" fill={fill} strokeWidth=".6" />
    </g>))}
  </>;

  if (kind === "horsechestnut" || kind === "woodlandBuckeye") return <>
    <path d="M60 119V79" stroke="#88714b" strokeWidth="2" />
    {(kind === "woodlandBuckeye" ? [-72, -36, 0, 36, 72] : [-100, -68, -34, 0, 34, 68, 100]).map((angle) => <g key={angle} transform={`translate(60 79) rotate(${angle}) scale(${Math.abs(angle) > 80 ? .56 : Math.abs(angle) > 40 ? .75 : .95})`}>
      <path d="M0 0Q-9-12-12-25L-16-30-13-35-17-40-13-45-16-50-11-55-10-61 0-73 10-61 11-55 16-50 13-45 17-40 13-35 16-30 12-25Q9-12 0 0Z" fill={fill} />
      <path d="M0 0V-67M0-20-10-30M0-34-12-44M0-48-9-56M0-20 10-30M0-34 12-44M0-48 9-56" stroke="#9aae6e" strokeWidth=".9" />
    </g>)}
  </>;
  if (kind === "palm") return <>
    <path d="M60 119V77" stroke="#807449" strokeWidth="3" />
    {Array.from({ length: 19 }, (_, i) => {
      const angle = -108 + i * 12;
      return <g key={i} transform={`translate(60 77) rotate(${angle})`}>
        <path d="M0 0-5-28-3-58 0-55 3-58 5-28Z" fill={i % 2 ? "#527844" : fill} />
        <path d="M0 0V-54" stroke="#9aae6e" strokeWidth=".6" />
      </g>;
    })}
  </>;
  if (kind === "yew" || kind === "fir") return <>
    <path d="M60 116V17" stroke="#8b7450" strokeWidth="2" />
    <path d="M58 18Q57 13 60 10Q63 13 62 18Z" fill="#8b7450" stroke="#6e5c3e" strokeWidth=".6" />
    {[-1,1].map(side => <g key={side} transform={`translate(60 ${side < 0 ? 23 : 25}) rotate(${side*32})`}>
      <path d={kind === "fir" ? "M-1 0-1.5-9Q-1-12 0-11Q1-12 1.5-9L1 0Z" : "M0 0Q-2-6 0-13Q2-6 0 0Z"} fill={fill} strokeWidth=".6" />
    </g>)}
    {Array.from({ length: 12 }, (_, i) => [-1, 1].map((side) => {
      const y = 30 + i * 6;
      const length = 22 + Math.sin(i / 12 * Math.PI) * 13;
      return <g key={`${i}-${side}`} transform={`translate(60 ${y + (side > 0 ? 2 : 0)}) rotate(${side * (kind === "fir" ? 48 : 67)})`}>
        <path d={kind === "fir" ? `M-1 0L-2 ${-length + 3}Q-2 ${-length} 0 ${-length + 1}Q2 ${-length} 2 ${-length + 3}L1 0Z` : `M0 0Q-3-12 0 ${-length}Q3-12 0 0Z`} fill={fill} strokeWidth=".7" />
      </g>;
    }))}
  </>;

  if (kind === "compound") return <>
    <path d="M60 117V45" stroke="#b88889" strokeWidth="2" />
    {[{ y: 62, angle: 0, scale: 1 }, { y: 75, angle: -57, scale: .84 }, { y: 75, angle: 57, scale: .84 }, { y: 99, angle: -62, scale: .8 }, { y: 99, angle: 62, scale: .8 }].map(({ y, angle, scale }) =>
      <g key={`${y}-${angle}`} transform={`translate(60 ${y}) rotate(${angle}) scale(${scale})`}>
        <path d="M0 0Q-14 -4 -16 -19L-20 -24-16 -29-18 -34-10 -38 0 -53 9 -39 17 -34 14 -28 19 -23 15 -18Q13 -5 0 0Z" fill="#e5e4c9" />
        <path d="M0 -3-8 -12-6 -19-12 -27-7 -31 0 -46 6 -31 11 -25 7 -19 10 -13Z" fill={fill} stroke="none" />
        <path d="M-10 -38 0 -53 9 -39 4 -37 0 -44-5 -36Z" fill="#d7a6aa" stroke="none" />
        <path d="M0 0V-47" stroke="#9eaf7c" strokeWidth=".8" />
      </g>)}
  </>;
  if (kind === "cedar") return <>
    <path d="M30 110 83 37" stroke="#8b7450" strokeWidth="3" />
    {[{ x: 47, y: 86 }, { x: 69, y: 55 }].map(({ x, y }) => <g key={x}>
      {Array.from({ length: 13 }, (_, i) => {
        const angle = (i * 25 + 15) * Math.PI / 180;
        return <path key={i} d={`M${x} ${y}l${Math.cos(angle) * 31} ${Math.sin(angle) * 31}`} />;
      })}
    </g>)}
  </>;
  if (kind === "flat") return <>
    <path d="M60 111V20" stroke="#8b7450" />
    <path d="M60 23Q51 18 53 10Q60 13 60 23Q69 18 67 10Q60 13 60 23Z" fill={fill} strokeWidth=".8" />
    {Array.from({ length: 10 }, (_, i) => {
      const y = 30 + i * 7;
      const width = 13 + Math.sin(i / 10 * Math.PI) * 23;
      return <g key={i} fill={fill}><path d={`M60 ${y}Q${60 - width} ${y - 5} ${60 - width} ${y - 14}Q48 ${y - 10} 60 ${y}ZM60 ${y + 3}Q${60 + width} ${y - 2} ${60 + width} ${y - 11}Q72 ${y - 7} 60 ${y + 3}Z`} /></g>;
    })}
  </>;
  return <>
    <path d="M60 111V18M60 81 34 51M60 65 85 34" stroke="#8b7450" />
    {[{ x: 60, y: 97, count: 10 }, { x: 39, y: 59, count: 4 }, { x: 80, y: 46, count: 4 }].map(({ x, y, count }) => <g key={x} fill={fill}>
      {Array.from({ length: count }, (_, i) => <path key={i} d={`M${x} ${y-i*7}q-10 -5 -12 -17l12 9 12 -9q-2 12 -12 17ZM${x} ${y-i*7}l-3 -11 3 -5 3 5Z`} />)}
    </g>)}
  </>;
}

function LeafDrawing({ foliage }: { foliage: Foliage }) {
  return <svg viewBox="0 0 120 125" aria-hidden="true" fill="none" stroke={foliage.stroke ?? "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {foliage.outline ? <>
      <path d={foliage.outline} fill={foliage.fill ?? "#e0edda"} />
      <path d={foliage.veins} stroke={foliage.veinStroke} strokeWidth={foliage.veinWidth ?? 1.2} />
      {foliage.midrib && <path d={foliage.midrib} stroke={foliage.midribStroke} strokeWidth="1" />}
    </> : <Branch kind={foliage.kind} fill={foliage.fill} />}
  </svg>;
}

export function TreeFoliageThumbnail({ tree }: { tree: Tree }) {
  const foliage = foliageForTree(tree);
  if (!foliage) return null;
  return <span className="tree-list-foliage" aria-hidden="true"><LeafDrawing foliage={foliage} /></span>;
}

export function TreeFoliage({ tree }: { tree: Tree }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialogRef.current?.close(); }, [tree.id]);
  const foliage = foliageForTree(tree);
  if (!foliage) return null;
  const taxon = foliage.sourceTaxon!;
  const fruit = fruitForTaxon(taxon);
  return <>
    <button type="button" className={`tree-foliage${fruit ? "" : " is-leaf-only"}`} onClick={() => dialogRef.current?.showModal()} aria-label={`Agrandir la feuille${fruit ? " et le fruit" : ""} : ${taxon}`} aria-haspopup="dialog">
      <span className="tree-foliage-illustration">
        <LeafDrawing foliage={foliage} />
        <span className="tree-foliage-caption">{foliage.label}</span>
      </span>
      {fruit && <span className="tree-foliage-illustration">
        <TreeFruit scientificName={taxon} />
        <span className="tree-foliage-caption">{fruit.label}</span>
      </span>}
    </button>
    {createPortal(<dialog className="botanical-dialog" ref={dialogRef} aria-labelledby={titleId}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogRef.current?.close();
        }
      }}>
      <div className="botanical-dialog-heading">
        <div><h2 id={titleId}>{tree.name}</h2><p>{taxon}</p></div>
        <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Fermer les schémas" autoFocus>×</button>
      </div>
      <div className={`botanical-drawings${fruit ? "" : " is-leaf-only"}`}>
        <figure>
          <LeafDrawing foliage={foliage} />
          <figcaption>{foliage.label}</figcaption>
        </figure>
        {fruit && <figure>
          <TreeFruit scientificName={taxon} />
          <figcaption>{fruit.label}</figcaption>
        </figure>}
      </div>
      <p className="botanical-source">Source : <a href={foliage.sourceUrl} target="_blank" rel="noreferrer">{foliage.sourceUrl?.includes("rhs.org.uk") ? "RHS" : foliage.sourceUrl?.includes("woodlandtrust.org.uk") ? "Woodland Trust" : foliage.sourceUrl?.includes("ncsu.edu") ? "NC State University" : "Oregon State University"} ↗</a>{foliage.sourceTaxon === "Fagus sylvatica 'Laciniata'" && fruit && <> · <a href={`${osu}${fruit.taxon.toLowerCase().replace(/ /g, "-")}`} target="_blank" rel="noreferrer">Oregon State University ↗</a></>}{["Thuja plicata 'Zebrina'", "Chamaecyparis lawsoniana 'Alumii'"].includes(taxon) && fruit && <> · <a href={`${osu}${fruit.taxon.toLowerCase().replace(/ /g, "-")}`} target="_blank" rel="noreferrer">Oregon State University (cône) ↗</a></>}{foliage.sourceTaxon === "Prunus cerasifera 'Pissardii'" && <> · <a href="https://plants.ces.ncsu.edu/plants/prunus-cerasifera/" target="_blank" rel="noreferrer">NC State University (fruit) ↗</a></>}</p>
    </dialog>, document.body)}
  </>;
}
