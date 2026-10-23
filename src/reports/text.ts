import type { Language } from "../agency.ts";
import type { MaintenanceAction } from "../maintenance-log.ts";

export interface ClientText {
  title: string;
  client: string;
  website: string;
  period: string;
  intro: string;
  workTitle: string;
  workDate: string;
  workDone: string;
  noWork: string;
  statusTitle: string;
  checkedOn: string;
  wordpress: string;
  plugins: string;
  themes: string;
  active: string;
  updates: string;
  manualCheck: string;
  partialNote: string;
  statusUnavailable: string;
  issuesTitle: string;
  coreUpdate: (version: string) => string;
  pendingUpdates: (count: number, names: string) => string;
  andMore: (count: number) => string;
  manualItems: (count: number) => string;
  license: (name: string, status: string) => string;
  checkFailed: string;
  noIssues: string;
  contact: (email: string) => string;
  page: (current: number, total: number) => string;
  actions: Record<MaintenanceAction, string>;
  licenseStatus: { expired: string; missing: string };
}

export const CLIENT_TEXT: Record<Language, ClientText> = {
  en: {
    title: "Website maintenance report",
    client: "Client",
    website: "Website",
    period: "Period",
    intro:
      "This report summarises the maintenance work we carried out on your website in this period and the current state of WordPress, its plugins and themes. Work is listed only after our team has confirmed it.",
    workTitle: "Work performed",
    workDate: "Date",
    workDone: "Work",
    noWork: "No maintenance work was recorded for this period.",
    statusTitle: "Current status",
    checkedOn: "Automated check",
    wordpress: "WordPress version",
    plugins: "Plugins",
    themes: "Themes",
    active: "active",
    updates: "Updates available",
    manualCheck: "Need a manual check",
    partialNote: "Some information could not be collected automatically and is checked manually.",
    statusUnavailable:
      "The automated status check could not be completed for this period. We will review the website manually.",
    issuesTitle: "Issues and next steps",
    coreUpdate: (version) => `WordPress ${version} is available. We recommend updating after a backup.`,
    pendingUpdates: (count, names) =>
      `Plugin and theme updates are available (${count}): ${names}. We recommend installing them after a backup.`,
    andMore: (count) => `and ${count} more`,
    manualItems: (count) =>
      `Some components cannot be checked automatically, for example premium plugins (${count}). We check them manually.`,
    license: (name, status) => `The license for ${name} needs attention (${status}).`,
    checkFailed: "Next step: we will review the website manually and restore the automated check.",
    noIssues: "The automated check found no open issues.",
    contact: (email) => `Questions? Contact us at ${email}.`,
    page: (current, total) => `Page ${current} of ${total}`,
    actions: {
      update: "Update",
      install: "Installation",
      remove: "Removal",
      activate: "Activation",
      deactivate: "Deactivation",
      configure: "Configuration",
      backup: "Backup",
      "security-check": "Security check",
      other: "Other",
    },
    licenseStatus: { expired: "expired", missing: "missing" },
  },
  sl: {
    title: "Poročilo o vzdrževanju spletne strani",
    client: "Naročnik",
    website: "Spletna stran",
    period: "Obdobje",
    intro:
      "Poročilo povzema vzdrževalna dela, ki smo jih v tem obdobju opravili na vaši spletni strani, ter trenutno stanje sistema WordPress, vtičnikov in tem. Navedena so samo dela, ki jih je potrdila naša ekipa.",
    workTitle: "Opravljena dela",
    workDate: "Datum",
    workDone: "Delo",
    noWork: "V tem obdobju ni zabeleženih vzdrževalnih del.",
    statusTitle: "Trenutno stanje",
    checkedOn: "Samodejni pregled",
    wordpress: "Različica WordPressa",
    plugins: "Vtičniki",
    themes: "Teme",
    active: "aktivni",
    updates: "Razpoložljive posodobitve",
    manualCheck: "Za ročni pregled",
    partialNote: "Nekaterih podatkov ni bilo mogoče pridobiti samodejno, zato jih preverimo ročno.",
    statusUnavailable:
      "Samodejnega pregleda stanja v tem obdobju ni bilo mogoče dokončati. Spletno stran bomo pregledali ročno.",
    issuesTitle: "Ugotovitve in naslednji koraki",
    coreUpdate: (version) => `Na voljo je WordPress ${version}. Priporočamo posodobitev po izdelavi varnostne kopije.`,
    pendingUpdates: (count, names) =>
      `Na voljo so posodobitve vtičnikov in tem (${count}): ${names}. Priporočamo namestitev po izdelavi varnostne kopije.`,
    andMore: (count) => `in še ${count}`,
    manualItems: (count) =>
      `Nekaterih komponent ni mogoče preveriti samodejno, na primer plačljivih vtičnikov (${count}). Preverimo jih ročno.`,
    license: (name, status) => `Licenca za ${name} zahteva pozornost (${status}).`,
    checkFailed: "Naslednji korak: spletno stran bomo pregledali ročno in ponovno vzpostavili samodejni pregled.",
    noIssues: "Samodejni pregled ni odkril odprtih težav.",
    contact: (email) => `Vprašanja? Pišite nam na ${email}.`,
    page: (current, total) => `Stran ${current} od ${total}`,
    actions: {
      update: "Posodobitev",
      install: "Namestitev",
      remove: "Odstranitev",
      activate: "Aktivacija",
      deactivate: "Deaktivacija",
      configure: "Nastavitve",
      backup: "Varnostna kopija",
      "security-check": "Varnostni pregled",
      other: "Drugo",
    },
    licenseStatus: { expired: "potekla", missing: "manjka" },
  },
};
