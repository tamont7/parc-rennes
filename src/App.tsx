import { Component, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { filterTrees, normalizeSearch, parseTreeData, TREE_COLORS, type Tree, type TreeData } from "./data";
import { PARK_PLAN_SOURCE_URL, SOURCE_URL } from "./park";
import { isPointInPark, parseParkPlan, type ParkLandmark, type ParkPlan } from "./plan";
import { TreeFoliage, TreeFoliageThumbnail } from "./TreeFoliage";

const DATA_URL = `${import.meta.env.BASE_URL}data/arbres-rennes.geojson`;
const THABOR_DATA_URL = `${import.meta.env.BASE_URL}data/arbres-thabor.geojson`;
const PLAN_URL = `${import.meta.env.BASE_URL}data/parc-oberthur.geojson`;
const THABOR_PLAN_URL = `${import.meta.env.BASE_URL}data/parc-thabor.geojson`;
const EMPTY_TREES: Tree[] = [];
type ParkView = "oberthur" | "thabor";

function parkFromLocation(): ParkView {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === `${import.meta.env.BASE_URL}thabor`) return "thabor";
  if (path === `${import.meta.env.BASE_URL}oberthur`) return "oberthur";
  return new URLSearchParams(window.location.search).get("plan") === "thabor" ? "thabor" : "oberthur";
}
type MapViewMode = "2d" | "3d";
type MobileSheetSnap = "low" | "medium" | "high";
const WIKIPEDIA_SEARCH_URL = "https://fr.wikipedia.org/w/index.php?search=";
const WIKIPEDIA_API_URL = "https://fr.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=";
type TreeSort = "vernacular" | "scientific" | "count" | "height" | "crown";
type SpeciesOption = { taxon: string; vernacularName: string; count: number };

const treeSortLabel: Record<TreeSort, string> = {
  vernacular: "nom usuel", scientific: "nom scientifique", count: "nombre d’arbres",
  height: "hauteur", crown: "houppier",
};
const TREE_SORT_ORDER: TreeSort[] = ["vernacular", "scientific", "count", "height", "crown"];

function speciesOptionLabel({ taxon, vernacularName }: SpeciesOption, sort: TreeSort) {
  return sort === "scientific" ? `${taxon} · ${vernacularName}` : `${vernacularName} · ${taxon}`;
}

function compareOptionalMeasurements(a: number | null, b: number | null) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

/* La liste répond à chaque frappe ; la reconstruction WebGL attend une pause. */
function useDebouncedValue<T>(value: T, delay = 180) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function wikipediaArticleUrl(title: string) {
  return `https://fr.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function resolveWikipediaArticle(tab: Window, scientificName: string) {
  try {
    const response = await fetch(`${WIKIPEDIA_API_URL}${encodeURIComponent(scientificName)}`);
    if (!response.ok) return;
    const result = await response.json() as { query?: { search?: Array<{ title?: string }> } };
    const title = result.query?.search?.[0]?.title;
    if (title && !tab.closed) tab.location.replace(wikipediaArticleUrl(title));
  } catch {
    // Le nouvel onglet garde la recherche Wikipédia de secours.
  }
}

function SpeciesName({ option, sort }: { option: SpeciesOption; sort: TreeSort }) {
  const primary = sort === "scientific" ? option.taxon : option.vernacularName;
  const secondary = sort === "scientific" ? option.vernacularName : option.taxon;
  return <span className="species-option-content"><span className="species-option-copy"><span className="species-option-primary">{primary}</span><span className="species-option-secondary">{secondary}</span></span><span className="species-option-count">{option.count} {option.count > 1 ? "arbres" : "arbre"}</span></span>;
}

function SpeciesPicker({ options, selectedTaxon, sort, onSelect }: {
  options: SpeciesOption[]; selectedTaxon: string; sort: TreeSort; onSelect: (taxon: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedOption = options.find((option) => option.taxon === selectedTaxon);
  const choose = (taxon: string) => { onSelect(taxon); detailsRef.current?.removeAttribute("open"); };
  return <div className="select-field">
    <details className="species-picker" ref={detailsRef}>
      <summary aria-label="Choisir une espèce">
        {selectedOption ? <SpeciesName option={selectedOption} sort={sort} /> : <span className="species-picker-placeholder">Toutes les espèces</span>}
        <span className="species-picker-chevron" aria-hidden="true" />
      </summary>
      <div className="species-picker-menu" role="group" aria-label="Toutes les espèces">
        <button type="button" className={`species-option ${!selectedTaxon ? "is-selected" : ""}`} onClick={() => choose("")}>
          <span className="species-option-primary">Toutes les espèces</span>
        </button>
        {options.map((option) => <button type="button" className={`species-option ${option.taxon === selectedTaxon ? "is-selected" : ""}`} key={option.taxon} onClick={() => choose(option.taxon)}>
          <SpeciesName option={option} sort={sort} />
        </button>)}
      </div>
    </details>
  </div>;
}

function TreeSortPicker({ sort, onChange }: { sort: TreeSort; onChange: (sort: TreeSort) => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const choose = (nextSort: TreeSort) => { onChange(nextSort); detailsRef.current?.removeAttribute("open"); };
  return <details className="sort-picker" ref={detailsRef}>
    <summary aria-label="Trier les arbres">
      <span className="sort-picker-label">Trier par</span><span className="sort-picker-value">{treeSortLabel[sort]}</span><span className="species-picker-chevron" aria-hidden="true" />
    </summary>
    <div className="sort-picker-menu" role="group" aria-label="Choisir le tri">
      {TREE_SORT_ORDER.map((option) => <button type="button" className={`sort-option ${option === sort ? "is-selected" : ""}`} key={option} onClick={() => choose(option)}>{treeSortLabel[option]}</button>)}
    </div>
  </details>;
}

function LeafIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C12 4 6 7 5 13c-1 5 6 9 10 4 2-3 3-7 5-13Z" /><path d="M4 20 15 11" /></svg>;
}
function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
function InfoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 10.8v5.2M12 7.8h.01" /></svg>;
}
function FullscreenIcon({ active }: { active: boolean }) {
  return active
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>;
}
function MapSceneLoading() {
  return <div className="map-scene-loading" role="status">
    <div className="map-scene-loading-tree" aria-hidden="true">
      <i className="map-scene-loading-crown is-back" />
      <i className="map-scene-loading-crown is-front" />
      <i className="map-scene-loading-trunk" />
    </div>
    <p>Préparation du parc</p>
    <span>Plan, arbres et reliefs</span>
  </div>;
}

function ParkTitle({ parkId, name }: { parkId: ParkView; name: string }) {
  const [previous, setPrevious] = useState({ parkId, name });
  const isChanging = previous.parkId !== parkId;

  useEffect(() => {
    if (!isChanging) return;
    const timer = window.setTimeout(() => setPrevious({ parkId, name }), 360);
    return () => window.clearTimeout(timer);
  }, [isChanging, name, parkId]);

  if (!isChanging) return <span><strong>{name}</strong></span>;

  return <span className="park-title-transition">
    <strong className="park-title-leaving" aria-hidden="true">{previous.name}</strong>
    <strong className="park-title-entering">{name}</strong>
  </span>;
}

function ParkPicker({ parkId, name, onChange }: { parkId: ParkView; name: string; onChange: (park: ParkView) => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const choose = (nextPark: ParkView) => {
    onChange(nextPark);
    detailsRef.current?.removeAttribute("open");
  };
  return <details className="park-picker" ref={detailsRef}>
    <summary aria-label="Choisir un parc">
      <span className="park-picker-copy"><ParkTitle parkId={parkId} name={name} /><small>2 parcs</small></span>
      <span className="park-picker-chevron" aria-hidden="true" />
    </summary>
    <div className="park-picker-menu" role="group" aria-label="Parcs disponibles">
      <button type="button" className={`park-picker-option ${parkId === "oberthur" ? "is-active" : ""}`} onClick={() => choose("oberthur")}>
        <span><strong>Parc Oberthür</strong></span>{parkId === "oberthur" && <i aria-label="Parc sélectionné" />}
      </button>
      <button type="button" className={`park-picker-option ${parkId === "thabor" ? "is-active" : ""}`} onClick={() => choose("thabor")}>
        <span><strong>Parc du Thabor</strong></span>{parkId === "thabor" && <i aria-label="Parc sélectionné" />}
      </button>
    </div>
  </details>;
}

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC" }).format(new Date(value)) : "Non renseignée";
}

class MapBoundary extends Component<{ children: ReactNode; onRetry: () => void; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() {
    return this.state.failed ? <div className="map-notice" role="alert">
      <p>La carte n’a pas pu démarrer. La liste et les fiches restent disponibles.</p>
      <button onClick={this.props.onRetry}>Réessayer la carte</button>
    </div> : this.props.children;
  }
}

function TreeDetail({
  tree,
  rawFeature,
  count,
  onClose,
  onToggleSpeciesFilter,
  onReturnToSearch,
  isSpeciesFilterActive,
  isMobile,
}: {
  tree: Tree;
  rawFeature: unknown;
  count: number;
  onClose: () => void;
  onToggleSpeciesFilter: () => void;
  onReturnToSearch?: () => void;
  isSpeciesFilterActive: boolean;
  isMobile: boolean;
}) {
  const rawDialogRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const headingRef =
    useRef<HTMLHeadingElement>(
      null,
    );

  const scientificName =
    tree.scientificName;

  const [
    detailsOpen,
    setDetailsOpen,
  ] =
    useState(false);

  const touchStartY =
    useRef<number | null>(
      null,
    );

  const dragOffsetRef =
    useRef(0);

  const suppressSwipeClick =
    useRef(false);

  const [
    dragOffset,
    setDragOffset,
  ] =
    useState(0);

  const [
    detailCanScroll,
    setDetailCanScroll,
  ] =
    useState(false);

  /*
   * Compatibilité pendant la transition :
   * les propriétés seront typées directement
   * dans data.ts juste après.
   */
  const measurements =
    tree as Tree & {
      crownDiameter?:
      | number
      | null;

      firstLeafHeight?:
      | number
      | null;
    };

  useEffect(() => {
    const timer =
      window.setTimeout(
        () =>
          headingRef.current?.focus(),
        0,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [tree.id]);

  useEffect(
    () =>
      setDetailsOpen(
        false,
      ),
    [tree.id],
  );

  useLayoutEffect(() => {
    const detail = detailRef.current;
    if (!detail) return;

    const updateScrollability = () => {
      setDetailCanScroll(detail.scrollHeight > detail.clientHeight + 1);
    };

    updateScrollability();
    const observer = new ResizeObserver(updateScrollability);
    observer.observe(detail);
    window.addEventListener("resize", updateScrollability);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScrollability);
    };
  }, [detailsOpen, tree.id]);

  const beginSwipe = (
    event:
      PointerEvent<HTMLElement>,
  ) => {
    const beginsInScrollableContent =
      event.target instanceof Element &&
      event.target.closest(".tree-detail-extra");

    if (
      !isMobile ||
      (detailsOpen &&
        event.currentTarget.scrollTop > 0 &&
        beginsInScrollableContent)
    ) {
      return;
    }

    if (
      event.pointerType ===
      "touch"
    ) {
      touchStartY.current =
        event.clientY;

      dragOffsetRef.current = 0;
      suppressSwipeClick.current = false;
    }
  };

  const moveSwipe = (
    event:
      PointerEvent<HTMLElement>,
  ) => {
    if (
      touchStartY.current !==
      null
    ) {
      const offset = event.clientY - touchStartY.current;
      dragOffsetRef.current = offset;
      if (Math.abs(offset) > 8) suppressSwipeClick.current = true;
      setDragOffset(offset);
    }
  };

  const resetSwipe = () => {
    touchStartY.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
  };

  const cancelSwipe = () => {
    resetSwipe();
    suppressSwipeClick.current = false;
  };

  const endSwipe = () => {
      const offset = dragOffsetRef.current;

      if (offset < -64 && isMobile) setDetailsOpen(true);
      else if (offset > 72) {
        if (isMobile && detailsOpen) setDetailsOpen(false);
        else onClose();
      }

      resetSwipe();

      /* Empêche un bouton ou un lien de s'activer après un glissement. */
      window.setTimeout(() => {
        suppressSwipeClick.current = false;
      }, 0);
    };

  const preventSwipeClick = (
    event: MouseEvent<HTMLElement>,
  ) => {
    if (!suppressSwipeClick.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <article
      ref={detailRef}
      className={`tree-detail ${detailsOpen ? "is-expanded" : ""} ${isMobile ? `is-mobile ${detailsOpen ? "is-mobile-expanded" : ""} ${detailCanScroll ? "can-scroll" : "cannot-scroll"}` : ""}`}
      aria-labelledby="detail-title"
      style={{
        transform:
          `translateY(${dragOffset}px)`,
      }}
      onPointerDown={beginSwipe}
      onPointerMove={moveSwipe}
      onPointerUp={endSwipe}
      onPointerCancel={cancelSwipe}
      onClickCapture={preventSwipeClick}
    >
      {isMobile && <div
        className="mobile-detail-handle"
        aria-label="Faire glisser la fiche"
      ><i aria-hidden="true" /></div>}
      <div className="detail-topline">
        <h2
          id="detail-title"
          ref={headingRef}
          tabIndex={-1}
        >
          {tree.name}
        </h2>

        <div className="detail-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            aria-label={detailsOpen ? "Réduire la fiche" : "Agrandir la fiche"}
            title={detailsOpen ? "Réduire la fiche" : "Agrandir la fiche"}
          >
            <FullscreenIcon active={detailsOpen} />
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Fermer la fiche"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {scientificName && (
        <p className="tree-summary-scientific">
          <a
            href={`${WIKIPEDIA_SEARCH_URL}${encodeURIComponent(
              scientificName,
            )}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Ouvrir le premier résultat Wikipédia pour ${scientificName}`}
            onClick={(event) => {
              const tab = window.open(
                `${WIKIPEDIA_SEARCH_URL}${encodeURIComponent(scientificName)}`,
                "_blank",
              );

              if (!tab) return;

              event.preventDefault();
              tab.opener = null;
              void resolveWikipediaArticle(tab, scientificName);
            }}
          >
            {scientificName} <span aria-hidden="true">↗</span>
          </a>
        </p>
      )}

      <div className="tree-summary-line">
        <p className="tree-summary">
          {tree.height != null && (
            <>↕ {tree.height} m</>
          )}

          {tree.circumference != null && (
            <> · ⟳ {tree.circumference} cm</>
          )}

          {measurements.crownDiameter != null && (
            <> · ⌀ {measurements.crownDiameter} m</>
          )}
        </p>
        <button
          type="button"
          className="tree-count"
          onClick={onToggleSpeciesFilter}
          aria-pressed={isSpeciesFilterActive}
          aria-label={`${isSpeciesFilterActive ? "Retirer le filtre" : "Filtrer"} : ${count} arbre${count > 1 ? "s" : ""} de cette espèce`}
          title={isSpeciesFilterActive ? "Retirer le filtre d’espèce" : "Filtrer cette espèce"}
        >{count} indiv.</button>
      </div>

      <div className="detail-footer">
        <TreeFoliage tree={tree} />
        {(!detailsOpen || isMobile) && <button
          className="detail-toggle"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? "Réduire" : "Détails"}
        </button>}
      </div>
      {isMobile && onReturnToSearch && <button type="button" className="mobile-return-to-search" onClick={onReturnToSearch} aria-label="Retour à la recherche" title="Retour à la recherche">
        <svg className="mobile-return-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>}

      {detailsOpen && (
        <div className="tree-detail-extra">
          {tree.sourceName &&
            tree.sourceName !==
            tree.name && (
              <p className="source-name">
                Nom publié :{" "}
                {
                  tree.sourceName
                }
              </p>
            )}

          {tree.photoUrl && (
            <img
              className="tree-photo"
              src={
                tree.photoUrl
              }
              alt={tree.name}
              loading="lazy"
            />
          )}

          {tree.description && (
            <p className="detail-description">
              {
                tree.description
              }
            </p>
          )}

          <dl className="tree-facts">
            <div>
              <dt>
                Hauteur
              </dt>

              <dd>
                {tree.height ===
                  null
                  ? "Non renseignée"
                  : `${tree.height} m`}
              </dd>
            </div>

            <div>
              <dt>
                Circonférence
              </dt>

              <dd>
                {tree.circumference ===
                  null
                  ? "Non renseignée"
                  : `${tree.circumference} cm`}
              </dd>
            </div>

            <div>
              <dt>
                Diamètre du
                houppier
              </dt>

              <dd>
                {measurements
                  .crownDiameter ===
                  null ||
                  measurements
                    .crownDiameter ===
                  undefined
                  ? "Non renseigné"
                  : `${measurements.crownDiameter} m`}
              </dd>
            </div>

            <div>
              <dt>
                Hauteur de
                première feuille
              </dt>

              <dd>
                {measurements
                  .firstLeafHeight ===
                  null ||
                  measurements
                    .firstLeafHeight ===
                  undefined
                  ? "Non renseignée"
                  : `${measurements.firstLeafHeight} m`}
              </dd>
            </div>

          </dl>

          <p className="coordinates">
            {tree.latitude.toFixed(
              6,
            )}
            ,{" "}
            {tree.longitude.toFixed(
              6,
            )}
          </p>
          <button type="button" className="detail-toggle raw-data-toggle" aria-haspopup="dialog" onClick={() => rawDialogRef.current?.showModal()}>Données brutes</button>
        </div>
      )}
      {isMobile && detailsOpen && <div className="mobile-detail-drag-surface" aria-hidden="true" />}
      {detailsOpen && !isMobile && <button
        className="detail-toggle desktop-detail-collapse"
        onClick={() => setDetailsOpen(false)}
        aria-expanded="true"
      >
        Réduire
      </button>}
      <dialog ref={rawDialogRef} className="info-dialog raw-data-dialog" aria-labelledby="raw-data-title" onKeyDown={(event) => event.stopPropagation()}>
        <div className="info-dialog-topline">
          <h2 id="raw-data-title">Données brutes</h2>
          <button type="button" className="icon-button" aria-label="Fermer les données brutes" onClick={() => rawDialogRef.current?.close()}><CloseIcon /></button>
        </div>
        <p>{tree.name} · Extrait GeoJSON de l’inventaire</p>
        <pre>{JSON.stringify(rawFeature, null, 2)}</pre>
      </dialog>
    </article>
  );
}

function LandmarkDetail({ landmark, onClose }: { landmark: ParkLandmark; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [landmark.id]);
  const { photo } = landmark.properties;
  const isBuilding = landmark.properties.kind === "building";
  return <article className="tree-detail landmark-detail" aria-labelledby="landmark-title">
    <div className="detail-topline">
      <h2 id="landmark-title" ref={headingRef} tabIndex={-1}>{landmark.properties.label}</h2>
      <button className="icon-button" onClick={onClose} aria-label="Fermer la fiche"><CloseIcon /></button>
    </div>
    {!isBuilding && <p className="landmark-description"></p>}
    <img className="tree-photo" src={photo.url} alt={landmark.properties.label} loading="lazy" />
  </article>;
}

export default function App() {
  const [data, setData] = useState<TreeData | null>(null);
  const [plan, setPlan] = useState<ParkPlan | null>(null);
  const [dataError, setDataError] = useState(false);
  const [dataAttempt, setDataAttempt] = useState(0);
  const [mapAttempt, setMapAttempt] = useState(0);
  const MapView = useMemo(() => lazy(() => import("./MapView")), [mapAttempt]);
  const [activePark, setActivePark] = useState<ParkView>(parkFromLocation);
  const [query, setQuery] = useState("");
  const [selectedSpecies, setSelectedSpecies] = useState("");
  const [speciesSort, setSpeciesSort] = useState<TreeSort>("vernacular");
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusTreeId, setFocusTreeId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [selectedLandmark, setSelectedLandmark] = useState<ParkLandmark | null>(null);
  const [hoveredTreeId, setHoveredTreeId] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>("3d");
  const [isParkTransitioning, setIsParkTransitioning] = useState(false);
  const [mapSceneReady, setMapSceneReady] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobileSheetSnap, setMobileSheetSnap] = useState<MobileSheetSnap>("low");
  const [returnToSearchAvailable, setReturnToSearchAvailable] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mapAreaRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const infoDialogRef = useRef<HTMLDialogElement>(null);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const explorerTouchStartY = useRef<number | null>(null);
  const [explorerDragOffset, setExplorerDragOffset] = useState(0);
  const parkName = activePark === "thabor" ? "Parc du Thabor" : "Parc Oberthür";
  const treeDataUrl = activePark === "thabor" ? THABOR_DATA_URL : DATA_URL;

  useEffect(() => {
    const onPopState = () => {
      const nextPark = parkFromLocation();
      if (nextPark !== activePark) {
        setIsParkTransitioning(true);
        setActivePark(nextPark);
      }
    };
    window.addEventListener("popstate", onPopState);
    // Preserve older shared links while giving them the new address.
    const url = new URL(window.location.href);
    if (url.searchParams.has("plan")) {
      url.pathname = `${import.meta.env.BASE_URL}${parkFromLocation()}`;
      url.searchParams.delete("plan");
      window.history.replaceState({}, "", url);
    }
    return () => window.removeEventListener("popstate", onPopState);
  }, [activePark]);

  useEffect(() => {
    document.title = `${parkName} — Parc Rennes`;
    setQuery("");
    setSelectedSpecies("");
    setSpeciesSort("vernacular");
    setSearchSuggestionsOpen(false);
    setSelectedId(null);
    setSelectedLandmark(null);
    setFocusTreeId(null);
    setHoveredTreeId(null);
    setMobilePanelOpen(false);
    setReturnToSearchAvailable(false);
    setMapSceneReady(false);
  }, [activePark, parkName]);


  useEffect(() => {
    const controller = new AbortController();
    setDataError(false);
    const timeout = window.setTimeout(() => {
      controller.abort();
      setDataError(true);
    }, 20_000);
    setPlan(null);
    setData(null);
    const planUrl = activePark === "thabor" ? THABOR_PLAN_URL : PLAN_URL;
    const parkPlan = fetch(planUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Plan indisponible");
        return response.json() as Promise<unknown>;
      })
      .then(parseParkPlan);
    const treeData = fetch(treeDataUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("GeoJSON indisponible");
        return response.json() as Promise<unknown>;
      });
    Promise.all([treeData, parkPlan])
      .then(([trees, nextPlan]) => {
        if (!controller.signal.aborted) {
          setData(parseTreeData(trees, (longitude, latitude) => isPointInPark(nextPlan, [longitude, latitude])));
          setPlan(nextPlan);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setDataError(true); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [dataAttempt, activePark]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => { setIsMobile(media.matches); setMobilePanelOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === mapAreaRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    updateFullscreen();
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (mobilePanelOpen && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    } else if (!mobilePanelOpen && dialog.open) {
      dialog.close();
    }
  }, [mobilePanelOpen, isMobile]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const dialog = dialogRef.current;
    if (!isMobile || !mobilePanelOpen || !viewport || !dialog) return;
    const updateViewport = () => {
      dialog.style.setProperty("--visible-height", `${viewport.height}px`);
      // À 90 %, le champ de recherche est déjà en haut du volet : remonter
      // également le dialogue quand le clavier apparaît crée un recentrage
      // inutile. Les ancrages plus bas gardent l'évitement du clavier.
      const keyboardInset = mobileSheetSnap === "high"
        ? 0
        : Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      dialog.style.setProperty("--keyboard-inset", `${keyboardInset}px`);
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
      dialog.style.removeProperty("--visible-height");
      dialog.style.removeProperty("--keyboard-inset");
    };
  }, [mobilePanelOpen, mobileSheetSnap, isMobile]);

  useEffect(() => {
    const dialog = infoDialogRef.current;
    if (!dialog) return;
    if (infoOpen && !dialog.open) dialog.showModal();
    else if (!infoOpen && dialog.open) dialog.close();
  }, [infoOpen]);

  const trees = data?.trees ?? EMPTY_TREES;
  const speciesStats = useMemo(() => {
    const stats = new Map<string, { vernacularName: string; count: number }>();
    for (const tree of trees) {
      const existing = stats.get(tree.species);
      if (existing) existing.count += 1;
      else stats.set(tree.species, { vernacularName: tree.name, count: 1 });
    }
    return stats;
  }, [trees]);
  const speciesOptions = useMemo(() => {
    return [...speciesStats].map(([taxon, { vernacularName, count }]) => ({ taxon, vernacularName, count }))
      .sort((a, b) => {
        if (speciesSort === "count") return b.count - a.count || a.vernacularName.localeCompare(b.vernacularName, "fr") || a.taxon.localeCompare(b.taxon, "fr");
        const scientificFirst = speciesSort === "scientific";
        const primary = scientificFirst ? a.taxon.localeCompare(b.taxon, "fr") : a.vernacularName.localeCompare(b.vernacularName, "fr");
        return primary || (scientificFirst ? a.vernacularName.localeCompare(b.vernacularName, "fr") : a.taxon.localeCompare(b.taxon, "fr"));
      });
  }, [speciesStats, speciesSort]);
  const filteredTrees = useMemo(() => filterTrees(trees, query, selectedSpecies, false), [trees, query, selectedSpecies]);
  const mapVisibleTrees = useDebouncedValue(filteredTrees);
  const visibleTrees = useMemo(() => [...filteredTrees].sort((a, b) => {
    if (speciesSort === "height") {
      const difference = compareOptionalMeasurements(a.height, b.height);
      if (difference) return difference;
    }
    if (speciesSort === "crown") {
      const difference = compareOptionalMeasurements(a.crownDiameter, b.crownDiameter);
      if (difference) return difference;
    }
    if (speciesSort === "count") {
      const countDifference = (speciesStats.get(b.species)?.count ?? 0) - (speciesStats.get(a.species)?.count ?? 0);
      if (countDifference) return countDifference;
    }
    const primaryA = speciesSort === "scientific" ? a.scientificName ?? a.name : a.name;
    const primaryB = speciesSort === "scientific" ? b.scientificName ?? b.name : b.name;
    const primary = primaryA.localeCompare(primaryB, "fr");
    if (primary) return primary;
    const secondaryA = speciesSort === "scientific" ? a.name : a.scientificName ?? a.name;
    const secondaryB = speciesSort === "scientific" ? b.name : b.scientificName ?? b.name;
    return secondaryA.localeCompare(secondaryB, "fr");
  }), [filteredTrees, speciesSort, speciesStats]);
  const suggestedSpecies = useMemo(() => {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length || selectedSpecies) return [];
    return speciesOptions.filter((option) => {
      const text = normalizeSearch(`${option.vernacularName} ${option.taxon}`);
      return terms.every((term) => text.includes(term));
    }).slice(0, 8);
  }, [query, selectedSpecies, speciesOptions]);
  const showSpeciesSuggestions = searchSuggestionsOpen && suggestedSpecies.length > 0;
  const selectedTree = visibleTrees.find((tree) => tree.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !visibleTrees.some((tree) => tree.id === selectedId)) setSelectedId(null);
    listRef.current?.scrollTo({ top: 0 });
  }, [visibleTrees]);

  useEffect(() => {
    if (hoveredTreeId && !visibleTrees.some((tree) => tree.id === hoveredTreeId)) setHoveredTreeId(null);
  }, [hoveredTreeId, visibleTrees]);

  const closeDetail = () => {
    const previousId = selectedId;
    setSelectedId(null);
    setReturnToSearchAvailable(false);
    if (isMobile) listTriggerRef.current?.focus();
    else listRef.current?.querySelector<HTMLButtonElement>(`[data-tree-id="${previousId}"]`)?.focus();
  };
  const closeLandmark = () => setSelectedLandmark(null);
  useEffect(() => {
    if ((!selectedTree && !selectedLandmark) || mobilePanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") selectedLandmark ? closeLandmark() : closeDetail(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId, selectedLandmark, mobilePanelOpen, isMobile]);

  const chooseTree = (tree: Tree, fromExplorer = false) => {
    setFocusTreeId(tree.id);
    setFocusRequest((request) => request + 1);
    setSelectedId(tree.id);
    setSelectedLandmark(null);
    setReturnToSearchAvailable(fromExplorer);
    setMobilePanelOpen(false);
  };
  const focusTree = (tree: Tree, fromExplorer = false) => {
    setFocusTreeId(tree.id);
    setFocusRequest((request) => request + 1);
    setSelectedId(tree.id);
    setSelectedLandmark(null);
    setReturnToSearchAvailable(fromExplorer);
    setMobilePanelOpen(false);
  };
  const chooseLandmark = (landmark: ParkLandmark) => { setSelectedLandmark(landmark); setSelectedId(null); setMobilePanelOpen(false); };
  const updateSearch = (value: string) => {
    setQuery(value);
    setSelectedSpecies(speciesOptions.find((option) => speciesOptionLabel(option, speciesSort) === value)?.taxon ?? "");
    setSearchSuggestionsOpen(Boolean(value));
  };
  const chooseSpecies = (taxon: string) => {
    setSelectedSpecies(taxon);
    const option = speciesOptions.find((item) => item.taxon === taxon);
    setQuery(option?.vernacularName ?? "");
    setSearchSuggestionsOpen(false);
    if (isMobile) setMobilePanelOpen(false);
  };
  const toggleSpeciesFilter = (taxon: string) => {
    if (selectedSpecies === taxon) {
      setSelectedSpecies("");
      setQuery("");
    } else {
      setSelectedSpecies(taxon);
      setQuery(speciesOptions.find((option) => option.taxon === taxon)?.vernacularName ?? "");
    }
    setSearchSuggestionsOpen(false);
  };
  const clearSearch = () => {
    setQuery("");
    setSelectedSpecies("");
    setSearchSuggestionsOpen(false);
    searchRef.current?.focus();
  };
  const changeTreeSort = (nextSort: TreeSort) => {
    setSpeciesSort(nextSort);
    const option = speciesOptions.find((item) => item.taxon === selectedSpecies);
    if (option) setQuery(option.vernacularName);
  };
  const clearFilters = () => { clearSearch(); setSpeciesSort("vernacular"); };
  const returnToPark = () => { setSelectedId(null); setSelectedLandmark(null); setRecenter((value) => value + 1); };
  const changePark = (nextPark: ParkView) => {
    if (nextPark === activePark) return;
    setIsParkTransitioning(true);
    setActivePark(nextPark);
    const url = new URL(window.location.href);
    url.pathname = `${import.meta.env.BASE_URL}${nextPark}`;
    url.searchParams.delete("plan");
    window.history.pushState({}, "", url);
  };
  const sheetSnaps: MobileSheetSnap[] = ["low", "medium", "high"];
  const moveMobileSheet = (direction: -1 | 1) => {
    const nextIndex = sheetSnaps.indexOf(mobileSheetSnap) + direction;
    if (nextIndex < 0) setMobilePanelOpen(false);
    else if (nextIndex < sheetSnaps.length) setMobileSheetSnap(sheetSnaps[nextIndex]);
  };
  const beginExplorerSwipe = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      explorerTouchStartY.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const moveExplorerSwipe = (event: PointerEvent<HTMLElement>) => {
    if (explorerTouchStartY.current !== null) setExplorerDragOffset(event.clientY - explorerTouchStartY.current);
  };
  const endExplorerSwipe = () => {
    if (explorerDragOffset > 72) moveMobileSheet(-1);
    else if (explorerDragOffset < -72) moveMobileSheet(1);
    explorerTouchStartY.current = null;
    setExplorerDragOffset(0);
  };
  const hasFilters = Boolean(query || speciesSort !== "vernacular");
  const openMobilePanel = () => {
    setMobileSheetSnap("high");
    setMobilePanelOpen(true);
  };
  const returnToSearch = () => {
    setSelectedId(null);
    setSelectedLandmark(null);
    setReturnToSearchAvailable(false);
    setMobileSheetSnap("high");
    setMobilePanelOpen(true);
  };
  const openInfo = () => {
    setMobilePanelOpen(false);
    setInfoOpen(true);
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await mapAreaRef.current?.requestFullscreen();
    } catch {
      // Le navigateur peut refuser le plein écran (iframe ou réglage utilisateur).
    }
  };

  const explorer = <>
    <div className="search-combobox">
      <div className="search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4.2 4.2" /></svg>
        <label className="sr-only" htmlFor="tree-search">Rechercher un arbre ou une espèce</label>
        <input id="tree-search" ref={searchRef} type="search" enterKeyHint="done" value={query} aria-controls="species-suggestions" aria-expanded={showSpeciesSuggestions} onFocus={() => { setSearchSuggestionsOpen(true); if (isMobile) setMobileSheetSnap("high"); }} onBlur={() => window.setTimeout(() => setSearchSuggestionsOpen(false), 120)} onChange={(event) => updateSearch(event.target.value)} onKeyDown={(event) => { if (isMobile && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); setSearchSuggestionsOpen(false); setMobilePanelOpen(false); } }} placeholder="Arbre ou espèce…" />
        {query && <button type="button" className="search-clear" onMouseDown={(event) => event.preventDefault()} onClick={clearSearch} aria-label="Effacer la recherche"><CloseIcon /></button>}
      </div>
      {showSpeciesSuggestions && <div className="species-suggestions" id="species-suggestions" aria-label="Suggestions d’espèces">
        {suggestedSpecies.map((option) => <button type="button" className="species-option" key={option.taxon} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSpecies(option.taxon)}>
          <SpeciesName option={option} sort={speciesSort} />
        </button>)}
      </div>}
    </div>
    <div className="filters">
      <SpeciesPicker options={speciesOptions} selectedTaxon={selectedSpecies} sort={speciesSort} onSelect={chooseSpecies} />
      {(!isMobile || mobileSheetSnap !== "low") && <TreeSortPicker sort={speciesSort} onChange={changeTreeSort} />}
    </div>
    <div className="results-heading">
      <p role="status">{data ? `${visibleTrees.length} / ${trees.length} arbres` : dataError ? "Données indisponibles" : "Chargement des arbres…"}</p>
      {hasFilters && <button className="text-button" onClick={clearFilters}>Réinitialiser</button>}
    </div>
    {(!isMobile || mobileSheetSnap !== "low") && <div className={`tree-list ${isParkTransitioning ? "is-park-transitioning" : ""}`} ref={listRef} aria-busy={!data && !dataError}>
      {dataError ? <div className="empty-state" role="alert">
        <p>Les données n’ont pas pu être chargées.</p>
        <button onClick={() => setDataAttempt((value) => value + 1)}>Réessayer les données</button>
      </div> : !data ? <p className="empty-state">Lecture de l’inventaire…</p> : visibleTrees.length ? visibleTrees.map((tree) => (
        <div key={tree.id} className="tree-list-row" onMouseEnter={() => setHoveredTreeId(tree.id)} onMouseLeave={() => setHoveredTreeId(null)}>
          <button data-tree-id={tree.id} className={`tree-list-item ${tree.id === selectedId ? "is-selected" : ""}`}
            aria-pressed={tree.id === selectedId} onFocus={() => setHoveredTreeId(tree.id)} onBlur={() => setHoveredTreeId(null)} onClick={() => chooseTree(tree, true)}>
            <span className="tree-dot" style={{ backgroundColor: tree.id === selectedId ? TREE_COLORS.selected : TREE_COLORS.normal }} aria-hidden="true" />
            <span className="tree-list-copy">
              <strong>{tree.name}</strong>
              <span>{tree.scientificName ?? "Taxon non renseigné"}</span>
              {(tree.height != null || tree.circumference != null || tree.crownDiameter != null) && <span className="tree-list-measurements">
                {tree.height != null && <>↕ {tree.height} m</>}
                {tree.circumference != null && <>{tree.height != null && " · "}⟳ {tree.circumference} cm</>}
                {tree.crownDiameter != null && <>{(tree.height != null || tree.circumference != null) && " · "}⌀ {tree.crownDiameter} m</>}
              </span>}
            </span>
          </button>
          <TreeFoliageThumbnail tree={tree} />
          <button type="button" className="focus-tree-button" onFocus={() => setHoveredTreeId(tree.id)} onBlur={() => setHoveredTreeId(null)} onClick={() => focusTree(tree, true)} aria-label={`Centrer la carte sur ${tree.name}`}>⌖</button>
        </div>
      )) : <div className="empty-state"><LeafIcon /><p>Aucun arbre ne correspond à ces critères.</p><button className="text-button" onClick={clearFilters}>Effacer les filtres</button></div>}
    </div>}
    {(!isMobile || mobileSheetSnap === "high") && <footer className="panel-footer">
      <button className="info-button" onClick={openInfo} aria-haspopup="dialog" aria-label="Informations sur les données"><InfoIcon /></button>
    </footer>}
  </>;

  return <main className="app-shell">
    <section ref={mapAreaRef} className={`map-area ${isParkTransitioning ? "is-transitioning" : ""}`} aria-label="Carte et fiche arbre">
      <MapBoundary
        key={mapAttempt}
        onRetry={() => {
          setMapSceneReady(false);
          setMapAttempt((value) => value + 1);
        }}
        onFailure={() => setMapSceneReady(true)}
      >
        <Suspense fallback={<MapSceneLoading />}>
          <MapView trees={trees} plan={plan} parkId={activePark} isParkTransitioning={isParkTransitioning} onSceneReady={() => { setIsParkTransitioning(false); setMapSceneReady(true); }} visibleTrees={mapVisibleTrees} interactiveTrees={visibleTrees} selectedTree={selectedTree} focusTreeId={focusTreeId} focusRequest={focusRequest} viewMode={mapViewMode} onChangeViewMode={() => setMapViewMode((mode) => mode === "3d" ? "2d" : "3d")} isMobile={isMobile} isMobilePanelOpen={mobilePanelOpen} hoveredTreeId={hoveredTreeId} onSelectTree={chooseTree} onSelectLandmark={chooseLandmark} onRecenter={() => setRecenter((value) => value + 1)} recenter={recenter} />
        </Suspense>
      </MapBoundary>
      <header className="map-header">
        <button className="brand" onClick={returnToPark} aria-label={`${parkName} — Recentrer la carte`}>
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        </button>
        <ParkPicker parkId={activePark} name={parkName} onChange={changePark} />
        <button type="button" className="fullscreen-toggle" onClick={toggleFullscreen} aria-pressed={isFullscreen} aria-label={isFullscreen ? "Quitter le mode plein écran" : "Activer le mode plein écran"}>
          <FullscreenIcon active={isFullscreen} />
          <span className="sr-only">{isFullscreen ? "Quitter le mode plein écran" : "Activer le mode plein écran"}</span>
        </button>
      </header>
      {selectedTree && <TreeDetail key={selectedTree.id} tree={selectedTree} rawFeature={data?.features.find((feature) => feature.id === selectedTree.id)} count={speciesStats.get(selectedTree.species)?.count ?? 1} onClose={closeDetail} onToggleSpeciesFilter={() => toggleSpeciesFilter(selectedTree.species)} isSpeciesFilterActive={selectedSpecies === selectedTree.species} onReturnToSearch={returnToSearchAvailable ? returnToSearch : undefined} isMobile={isMobile} />}
      {selectedLandmark && <LandmarkDetail landmark={selectedLandmark} onClose={closeLandmark} />}
      <nav className={`mobile-bottom-bar ${!mapSceneReady || mobilePanelOpen || selectedTree || selectedLandmark ? "is-hidden" : ""}`} aria-label="Navigation principale">
        <button ref={listTriggerRef} className="mobile-sheet-trigger" onClick={openMobilePanel}
        aria-haspopup="dialog" aria-expanded={mobilePanelOpen} aria-controls="mobile-explorer">
          <LeafIcon /><span>Explorer</span>
        </button>
      </nav>
    </section>
    {isMobile ? <dialog id="mobile-explorer" className={`explorer-panel is-mobile-${mobileSheetSnap}`} ref={dialogRef} aria-label="Explorer les arbres" tabIndex={-1} style={{ transform: `translateY(${explorerDragOffset}px)` }}
      onCancel={(event) => { event.preventDefault(); setMobilePanelOpen(false); }}
      onClose={() => setMobilePanelOpen(false)} onClick={(event) => {
        // Sur un dialogue modal, un clic sur le backdrop remonte au dialogue.
        // Il doit donc fermer le volet plutôt que changer sa hauteur.
        if (event.target === event.currentTarget) setMobilePanelOpen(false);
      }}><div className={`mobile-panel-handle is-${mobileSheetSnap}`} onPointerDown={beginExplorerSwipe} onPointerMove={moveExplorerSwipe} onPointerUp={endExplorerSwipe} onPointerCancel={endExplorerSwipe}>
        <i aria-hidden="true" />
      </div>
      <div className={`mobile-panel-title is-${mobileSheetSnap}`}>
        <div><strong>{mobileSheetSnap === "medium" ? "Aperçu des arbres" : "Explorer les arbres"}</strong></div>
        <div className="mobile-panel-actions">
          <button type="button" className="icon-button mobile-close-panel" onClick={() => setMobilePanelOpen(false)} aria-label="Fermer l’explorateur"><CloseIcon /></button>
        </div>
      </div>{explorer}</dialog>
      : <aside
        className={`explorer-panel ${!mapSceneReady ? "is-map-loading" : ""}`}
        aria-label="Liste des arbres"
        aria-busy={!mapSceneReady}
        {...(!mapSceneReady ? { inert: "" } : {})}
      >{explorer}</aside>}
    <dialog className="info-dialog" ref={infoDialogRef} aria-labelledby="info-title" onClose={() => setInfoOpen(false)}>
      <div className="info-dialog-topline">
        <div><p className="eyebrow">Informations</p><h2 id="info-title">Données et sources</h2></div>
        <button className="icon-button" autoFocus onClick={() => setInfoOpen(false)} aria-label="Fermer les informations"><CloseIcon /></button>
      </div>
      <p>Les positions et caractéristiques présentées proviennent d’un inventaire ; elles ne constituent pas une observation en temps réel.</p>
      <dl className="info-list">
        <div><dt>Version</dt><dd>V1.4</dd></div>
        <div><dt>Inventaire</dt><dd><a href={SOURCE_URL} target="_blank" rel="noreferrer">Rennes Métropole</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL 1.0</a></dd></div>
        {data && <div><dt>Extrait</dt><dd>{dateLabel(data.metadata.imported_at)} · <a href={treeDataUrl} download>GeoJSON</a></dd></div>}
        <div><dt>Couverture</dt><dd>Points GPS contenus dans l’emprise officielle du parc ; les champs descriptifs ne servent pas à la sélection.</dd></div>
        <div><dt>Plan du parc</dt><dd><a href={PARK_PLAN_SOURCE_URL} target="_blank" rel="noreferrer">Emprise : Rennes Métropole</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Allées et plans d’eau : OpenStreetMap contributors</a> · <a href={activePark === "thabor" ? THABOR_PLAN_URL : PLAN_URL} download>GeoJSON</a> · ODbL 1.0</dd></div>
        <div><dt>Repères 3D</dt><dd>Volumes indicatifs : les hauteurs de bâtiments ne sont pas publiées par les sources. Photos au clic : Wikimedia Commons.</dd></div>
      </dl>
    </dialog>
  </main>;
}
