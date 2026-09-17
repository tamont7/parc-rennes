import {
  createTreeCollectionSchema,
  treeCollectionSchema,
  type TreeCollection,
} from "./treeSchema";

export type Tree = {
  id: string;

  sourceId: number;

  managementId:
  | string
  | null;

  name: string;

  sourceName:
  | string
  | null;

  scientificName:
  | string
  | null;

  species: string;

  latitude: number;

  longitude: number;

  /*
   * Hauteur totale en mètres.
   */
  height:
  | number
  | null;

  /*
   * Circonférence du tronc en cm.
   */
  circumference:
  | number
  | null;

  /*
   * Diamètre du houppier en mètres.
   */
  crownDiameter:
  | number
  | null;

  /*
   * Hauteur de la première feuille
   * en mètres.
   */
  firstLeafHeight:
  | number
  | null;

  remarkable:
  | boolean
  | null;

  description:
  | string
  | null;

  plantedAt:
  | string
  | null;

  updatedAt:
  | string
  | null;

  photoUrl:
  | string
  | null;

  model3dUrl:
  | string
  | null;

  pruning:
  | string
  | null;

  location:
  | string
  | null;
};

export function parseTreeData(
  value: unknown,
  containsPoint?: (longitude: number, latitude: number) => boolean,
) {
  const collection =
    (containsPoint ? createTreeCollectionSchema(containsPoint) : treeCollectionSchema).parse(
      value,
    );

  const trees: Tree[] =
    collection.features.map(
      ({
        id,
        geometry,
        properties: p,
      }) => ({
        id,

        sourceId:
          p.source_id,

        managementId:
          p.id_gestion,

        name:
          p.nom,

        sourceName:
          p.nom_source,

        scientificName:
          p.nom_scientifique,

        species:
          p.nom_scientifique ??
          p.nom,

        longitude:
          geometry
            .coordinates[0],

        latitude:
          geometry
            .coordinates[1],

        height:
          p.hauteur_m,

        circumference:
          p.circonference_cm,

        /*
         * Nouvelles données utilisées
         * par MapView.tsx.
         */
        crownDiameter:
          p.houppier_m,

        firstLeafHeight:
          p.hauteur_1_ere_feuille_m,

        remarkable:
          p.remarquable,

        description:
          p.description,

        plantedAt:
          p.date_plantation,

        updatedAt:
          p.date_maj,

        photoUrl:
          p.photo_url,

        model3dUrl:
          p.model_3d_url,

        pruning:
          p.type_taille,

        location:
          p.localisation,
      }),
    );

  return {
    trees,
    features: collection.features,
    metadata:
      collection.metadata,
  };
}

export type TreeData = {
  trees: Tree[];
  features: TreeCollection["features"];

  metadata:
  TreeCollection["metadata"];
};

export function normalizeSearch(
  value: string,
) {
  return value
    .normalize("NFD")
    .replace(
      /\p{M}/gu,
      "",
    )
    .toLocaleLowerCase(
      "fr",
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    )
    .trim();
}

export function filterTrees(
  trees: Tree[],
  query: string,
  species: string,
  remarkableOnly: boolean,
) {
  const terms =
    normalizeSearch(
      // Une espèce sélectionnée prime sur le nom usuel affiché dans la recherche.
      // Ce nom peut varier entre les arbres d’un même taxon.
      species ? "" : query,
    )
      .split(/\s+/)
      .filter(Boolean);

  return trees.filter(
    (tree) => {
      const text =
        normalizeSearch(
          [
            tree.name,
            tree.scientificName,
          ].join(" "),
        );

      return (
        terms.every(
          (term) =>
            text.includes(
              term,
            ),
        ) &&
        (!species ||
          tree.species ===
          species) &&
        (!remarkableOnly ||
          tree.remarkable ===
          true)
      );
    },
  );
}

export const TREE_COLORS = {
  normal:
    "#2f8b62",

  remarkable:
    "#d99020",

  selected:
    "#7c3aed",
};

export function treeColor(
  tree: Pick<
    Tree,
    "remarkable"
  >,

  selected: boolean,
) {
  return selected
    ? TREE_COLORS.selected
    : tree.remarkable ===
      true
      ? TREE_COLORS.remarkable
      : TREE_COLORS.normal;
}

export type TreeHighlight =
  | "normal"
  | "selected"
  | "hovered"
  | "same_species";

export function treeHighlight(
  tree: Pick<
    Tree,
    "id" | "species"
  >,

  selectedTreeId:
    | string
    | null,

  hoveredTree: Pick<
    Tree,
    "id" | "species"
  > | null,
): TreeHighlight {
  if (
    tree.id ===
    hoveredTree?.id
  ) {
    return "hovered";
  }

  if (
    tree.id ===
    selectedTreeId
  ) {
    return "selected";
  }

  if (
    hoveredTree &&
    tree.species ===
    hoveredTree.species
  ) {
    return "same_species";
  }

  return "normal";
}
