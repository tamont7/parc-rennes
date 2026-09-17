import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { filterTrees, parseTreeData, treeColor, treeHighlight, TREE_COLORS } from "../src/data";
import { isParkLandmark, isPointInPark, parseParkPlan } from "../src/plan";
import { createTreeCollectionSchema } from "../src/treeSchema";
import { importRennes, normalizeRecord } from "../scripts/import-rennes";
import { isThaborPath, parseThaborPlan } from "../scripts/import-thabor-plan";
import { extractParkEntrances } from "../scripts/park-entrances";

const snapshot = JSON.parse(readFileSync(new URL("../public/data/arbres-rennes.geojson", import.meta.url), "utf8"));
const planSnapshot = JSON.parse(readFileSync(new URL("../public/data/parc-oberthur.geojson", import.meta.url), "utf8"));
const thaborPlanSnapshot = JSON.parse(readFileSync(new URL("../public/data/parc-thabor.geojson", import.meta.url), "utf8"));
const thaborTreeSnapshot = JSON.parse(readFileSync(new URL("../public/data/arbres-thabor.geojson", import.meta.url), "utf8"));
const plan = parseParkPlan(planSnapshot);
const { trees, metadata } = parseTreeData(snapshot, (longitude, latitude) => isPointInPark(plan, [longitude, latitude]));
const first = snapshot.features[0];

test("le filtre d’espèce conserve les arbres portant des noms usuels différents", () => {
  const thaborPlan = parseThaborPlan(thaborPlanSnapshot);
  const { trees: thaborTrees } = parseTreeData(thaborTreeSnapshot,
    (longitude, latitude) => isPointInPark(thaborPlan, [longitude, latitude]));

  for (const [species, name, count] of [
    ["Ginkgo biloba", "Arbre aux 40 écus", 3],
    ["Juglans nigra", "Noyer noir", 2],
    ["Prunus lusitanica", "Cerisier", 3],
  ] as const) {
    const expected = thaborTrees.filter((tree) => tree.species === species);
    assert.equal(expected.length, count);
    assert.deepEqual(filterTrees(thaborTrees, name, species, false), expected);
    assert(filterTrees(thaborTrees, name, "", false)
      .filter((tree) => tree.species === species).length < count);
  }

  const ginkgo = thaborTrees.find((tree) => tree.species === "Ginkgo biloba")!;
  const remarkable = { ...ginkgo, name: "Autre nom usuel", remarkable: true };
  assert.deepEqual(filterTrees([remarkable, ...thaborTrees], "Arbre aux 40 écus", "Ginkgo biloba", true), [remarkable]);
});

test("les entrées sont des points OSM et les allées voisines de Saint-Melaine sont présentes", () => {
  const thabor = parseThaborPlan(thaborPlanSnapshot);
  assert.equal(plan.features.filter((f) => f.properties.kind === "entrance").length, 5);
  assert.equal(thabor.features.filter((f) => f.properties.kind === "entrance").length, 10);
  assert(thabor.features.some((f) => f.properties.source_id === "way/145259767"));
  assert(thabor.features.some((f) => f.properties.source_id === "way/242062604"));
  assert(!thabor.features.some((f) => f.properties.source_id === "node/14061121986"));
  assert.equal(isThaborPath({ id: "private", coordinates: [[-1.673, 48.115]], tags: { highway: "footway", access: "private" } }, []), false);
  assert.equal(isThaborPath({ id: "outside", coordinates: [[-1.68, 48.12]], tags: { highway: "footway" } }, []), false);
});

test("l’import des entrées exclut une porte verrouillée et une porte de bâtiment", () => {
  const xml = `<osm>
    <node id="1" lon="-1.66" lat="48.11"><tag k="barrier" v="gate"/></node>
    <node id="2" lon="-1.66" lat="48.12"><tag k="barrier" v="gate"/><tag k="locked" v="yes"/></node>
    <node id="3" lon="-1.66" lat="48.13"><tag k="entrance" v="yes"/></node>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="leisure" v="park"/><tag k="wikidata" v="Q1"/></way>
    <way id="11"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="footway"/></way>
    <way id="12"><nd ref="3"/><tag k="building" v="yes"/></way>
  </osm>`;
  assert.deepEqual(extractParkEntrances(xml, "Q1").map((entry) => entry.properties.source_id), ["node/1"]);
});
const record = { ...first.properties.source_properties, geo_shape: { geometry: first.geometry } };

test("l’extrait Oberthür est valide, traçable et limité par son point GPS à l’emprise officielle", () => {
  assert(trees.length > 0);
  assert.equal(new Set(trees.map((tree) => tree.id)).size, trees.length);
  assert.equal(metadata.imported_records, trees.length);
  assert.equal(metadata.bbox_records, trees.length + metadata.excluded_felled + (metadata.excluded_outside_park ?? -1));
  assert.equal(metadata.excluded_outside_park, 20);
  assert(trees.every((tree) => isPointInPark(plan, [tree.longitude, tree.latitude])));
  assert(snapshot.features.every((feature: typeof first) => feature.properties.source_properties.abattu !== 1));
  assert.equal(metadata.license, "Licence ODbL 1.0");
});

test("un arbre dans l’emprise GPS est retenu même si sa localisation éditoriale est absente", () => {
  const cèdre = trees.find((tree) => tree.sourceId === 135502);
  const feature = snapshot.features.find((item: typeof first) => item.properties.source_id === 135502);
  assert(cèdre && feature);
  assert.equal(cèdre.name, "Cèdre de l'Atlas");
  assert.equal(cèdre.location, null);
  assert.equal(feature.properties.source_properties.gml_id, "arbre.135502");
  assert.equal(feature.properties.source_properties.code_insee, "35238");
});

test("le plan vectoriel embarque l’emprise officielle, les axes, l’étang et les repères", () => {
  const boundaries = plan.features.filter((feature) => feature.properties.kind === "boundary");
  const water = plan.features.filter((feature) => feature.properties.kind === "water");
  const paths = plan.features.filter((feature) => feature.properties.kind === "path");
  const landmarks = plan.features.filter(isParkLandmark);
  const hotel = landmarks.find((feature) => feature.properties.kind === "building");
  const kiosque = landmarks.find((feature) => feature.properties.kind === "landmark");
  assert.equal(boundaries.length, 1);
  assert.equal(boundaries[0].properties.source, "Rennes Métropole");
  assert.equal(water.length, 1);
  assert.equal(paths.length, 36);
  assert.equal(hotel?.properties.label, "Hôtel Oberthür");
  assert.equal(kiosque?.properties.label, "Kiosque");
  assert.equal(hotel?.properties.photo.license, "CC BY-SA 3.0");
  assert.equal(kiosque?.properties.photo.license, "CC BY-SA 3.0");
  assert.equal(plan.metadata.rennes_metropole.license, "Licence ODbL 1.0");
  assert(plan.metadata.buildings);
  assert.equal(plan.metadata.buildings.license, "Licence ODbL 1.0");
  assert.equal(plan.metadata.openstreetmap.license, "ODbL 1.0");
});

test("le plan du Thabor embarque ses repères architecturaux", () => {
  const thabor = parseThaborPlan(thaborPlanSnapshot);
  const kinds = thabor.features.map((feature) => feature.properties.kind);
  const landmarks = thabor.features.filter(isParkLandmark);
  assert.equal(kinds.filter((kind) => kind === "boundary").length, 1);
  assert(kinds.filter((kind) => kind === "path").length > 100);
  assert(kinds.filter((kind) => kind === "water").length > 0);
  assert.equal(landmarks.length, 3);
  assert.deepEqual(landmarks.map((feature) => feature.properties.label).sort(), ["Kiosque à musique", "Orangerie du Thabor", "Église Notre-Dame-en-Saint-Melaine"].sort());
  assert(landmarks.every((feature) => feature.properties.height_m > 0));
  assert.equal(thabor.metadata.rennes_metropole.license, "Licence ODbL 1.0");
  assert.equal(thabor.metadata.openstreetmap.license, "ODbL 1.0");
});

test("les arbres du Thabor sont sélectionnés par leur point GPS dans l’emprise officielle", () => {
  const thaborPlan = parseThaborPlan(thaborPlanSnapshot);
  const { trees: thaborTrees, metadata: thaborMetadata } = parseTreeData(thaborTreeSnapshot, (longitude, latitude) => isPointInPark(thaborPlan, [longitude, latitude]));
  assert.equal(thaborTrees.length, 1081);
  assert(thaborTrees.every((tree) => isPointInPark(thaborPlan, [tree.longitude, tree.latitude])));
  assert.equal(thaborMetadata.selection, "Points GPS situés dans l’emprise officielle du Parc du Thabor ; abattu=1 exclu.");
  assert.equal(thaborMetadata.bbox_records, thaborMetadata.imported_records + thaborMetadata.excluded_felled + (thaborMetadata.excluded_outside_park ?? -1));
  assert.equal(thaborMetadata.excluded_outside_park, 149);
  assert.equal(thaborMetadata.boundary_source_id, "v_evert_rm.fid--75dfcf00_1a08a2bb262_-7482");
});

test("l’import conserve l’identité et les unités, sans inventer de statut ni de mesure", () => {
  const result = normalizeRecord({ ...record, hauteur: 0, circonference: null, complement: "Non renseigné" });
  assert(result.feature);
  assert.equal(result.feature.id, `rennes-arbre-${record.id}`);
  assert.equal(result.feature.properties.hauteur_m, null);
  assert.equal(result.feature.properties.circonference_cm, null);
  assert.equal(result.feature.properties.remarquable, null);
  assert.equal(result.feature.properties.model_3d_url, null);
  assert.equal(result.feature.properties.description, null);
  assert.equal(result.feature.properties.source_properties.hauteur, 0);
  const measured = normalizeRecord({ ...record, hauteur: 12, circonference: 150 });
  assert.equal(measured.feature?.properties.hauteur_m, 12);
  assert.equal(measured.feature?.properties.circonference_cm, 150);
  const implausibleCrown = normalizeRecord({ ...record, houppier: 80 });
  assert.equal(implausibleCrown.feature?.properties.houppier_m, null);
  assert.equal(implausibleCrown.feature?.properties.source_properties.houppier, 80);
});

test("un nom français corrigé reste traçable au libellé publié", () => {
  const hêtrePourpre = normalizeRecord({
    ...record,
    nom_commun: "Hêtre commun",
    genre: "Fagus",
    espece: "sylvatica",
    variete: "Purpurea",
  });
  assert.equal(hêtrePourpre.feature?.properties.nom, "Hêtre pourpre");
  assert.equal(hêtrePourpre.feature?.properties.nom_source, "Hêtre commun");
  assert.equal(hêtrePourpre.feature?.properties.nom_scientifique, "Fagus sylvatica Purpurea");
});

test("le hêtre pleureur utilise le nom de cultivar correct", () => {
  const hêtrePleureur = normalizeRecord({
    ...record,
    nom_commun: "Hêtre commun",
    genre: "Fagus",
    espece: "sylvatica",
    variete: "Pendula",
  });
  assert.equal(hêtrePleureur.feature?.properties.nom, "Hêtre pleureur");
  assert.equal(hêtrePleureur.feature?.properties.nom_source, "Hêtre commun");
  assert.equal(hêtrePleureur.feature?.properties.nom_scientifique, "Fagus sylvatica Pendula");
});

test("les arbres dans l’emprise GPS sont publiés, sauf s’ils sont signalés abattus", () => {
  assert(normalizeRecord({ ...record, localisation: null }).feature);
  assert.equal(normalizeRecord({ ...record, abattu: 1 }).reason, "felled");
});

test("des coordonnées inversées, identifiants dupliqués ou champs manquants sont rejetés", () => {
  const oberthurSchema = createTreeCollectionSchema((longitude, latitude) => isPointInPark(plan, [longitude, latitude]));
  const invalid = structuredClone(snapshot);
  invalid.features[0].geometry.coordinates.reverse();
  assert.equal(oberthurSchema.safeParse(invalid).success, false);
  const duplicate = structuredClone(snapshot);
  duplicate.features[1].id = duplicate.features[0].id;
  assert.equal(oberthurSchema.safeParse(duplicate).success, false);
  assert.throws(() => normalizeRecord({ id: 1 }));
});

test("la recherche ignore les accents, accepte les suggestions composées et combine texte, taxon et statut explicite", () => {
  const accent = filterTrees(trees, "érable", "", false);
  assert(accent.length > 0);
  assert.deepEqual(accent, filterTrees(trees, "ERABLE", "", false));
  assert.equal(filterTrees(trees, `${trees[0].name} · ${trees[0].species}`, "", false)[0].id, trees[0].id);
  assert.equal(filterTrees(trees, String(trees[0].sourceId), "", false).length, 0);
  assert.equal(filterTrees(trees, "zzzintrouvable", "", false).length, 0);
  assert.equal(filterTrees(trees, "", "", true).length, 0);
  const marked = [{ ...trees[0], remarkable: true }, { ...trees[1], remarkable: false }, trees[2]];
  assert.deepEqual(filterTrees(marked, "", "", true), [marked[0]]);
});

test("les symboles distinguent sélection, remarquable et arbre ordinaire", () => {
  assert.equal(treeColor({ remarkable: null }, false), TREE_COLORS.normal);
  assert.equal(treeColor({ remarkable: true }, false), TREE_COLORS.remarkable);
  assert.equal(treeColor({ remarkable: true }, true), TREE_COLORS.selected);
});

test("la mise en évidence privilégie le survol, puis la sélection, puis le même taxon", () => {
  const hovered = trees.find((tree) => trees.some((other) => other.id !== tree.id && other.species === tree.species));
  assert(hovered);
  const sameSpecies = trees.find((tree) => tree.id !== hovered.id && tree.species === hovered.species);
  const otherSpecies = trees.find((tree) => tree.species !== hovered.species);
  assert(sameSpecies && otherSpecies);
  assert.equal(treeHighlight(hovered, null, hovered), "hovered");
  assert.equal(treeHighlight(sameSpecies, null, hovered), "same_species");
  assert.equal(treeHighlight(sameSpecies, hovered.id, hovered), "same_species");
  assert.equal(treeHighlight(sameSpecies, sameSpecies.id, hovered), "selected");
  assert.equal(treeHighlight(otherSpecies, null, hovered), "normal");
});

test("une pagination interrompue ne remplace jamais l’extrait utilisable", async () => {
  const path = new URL("../public/data/arbres-rennes.geojson", import.meta.url);
  const before = readFileSync(path, "utf8");
  const boundary = plan.features.find((feature) => feature.properties.kind === "boundary");
  assert(boundary && boundary.geometry.type === "MultiPolygon");
  const originalFetch = globalThis.fetch;
  let request = 0;
  globalThis.fetch = async () => {
    const responses = [
      { metas: { default: { license: "Licence ODbL 1.0", license_url: "https://opendatacommons.org/licenses/odbl/", data_processed: null } } },
      { results: [{ gml_id: boundary.properties.source_id, nom: "Parc Hamelin Oberthür", geo_shape: { geometry: boundary.geometry } }] },
      { total_count: 2, results: [record] },
      { total_count: 2, results: [] },
    ];
    return new Response(JSON.stringify(responses[request++]), { status: 200 });
  };
  try {
    await assert.rejects(importRennes, /Pagination incomplète/);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
