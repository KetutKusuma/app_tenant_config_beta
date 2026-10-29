import { DocsModal } from "./components/DocsModal";
import { WorkflowDocsModal } from "./components/WorkflowDocsModal";
import { StudioProvider, useStudioRoot } from "./studio/StudioContext";
import type { AppProps } from "./types";
import { StudioHeader } from "./components/studio/StudioHeader";
import { GlobalOverlays } from "./components/studio/GlobalOverlays";
import { Sidebar } from "./components/studio/Sidebar";
import { EditorToolbar } from "./components/studio/EditorToolbar";
import { EditorArea } from "./components/studio/EditorArea";
import { ValidationPanel } from "./components/studio/ValidationPanel";
import { ReferenceDrawer } from "./components/studio/ReferenceDrawer";
import { HistoryPanel } from "./components/studio/HistoryPanel";
import { TenantModal } from "./components/studio/TenantModal";
import { AddConfigModal } from "./components/studio/AddConfigModal";
import { DeleteConfigModal } from "./components/studio/DeleteConfigModal";
import { SavePresetModal } from "./components/studio/SavePresetModal";
import { SyncCenterModal } from "./components/studio/SyncCenterModal";
import { CompareTenantModal } from "./components/studio/CompareTenantModal";
import { EnvCompareScreen } from "./components/studio/EnvCompareScreen";

// Kerangka Tenant Studio. State & aksi ada di studio/ (hook), tiap bagian UI di components/studio/.
export default function App(props: AppProps) {
  const studio = useStudioRoot(props);
  const { showDocsModal, setShowDocsModal, configDomain } = studio;

  return (
    <StudioProvider value={studio}>
      <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans">
        <StudioHeader />
        <GlobalOverlays />

        {/* Main Studio Workspace */}
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />

          {/* Center Workspace (Primary Editor + Optional Split Pane) */}
          <main className="flex-1 flex flex-col bg-slate-950 min-w-0 min-h-0 overflow-hidden">
            <EditorToolbar />
            <EditorArea />
            <ValidationPanel />
          </main>

          <ReferenceDrawer />
          <HistoryPanel />
        </div>

        <TenantModal />
        <AddConfigModal />
        <DeleteConfigModal />
        <SavePresetModal />
        <SyncCenterModal />
        <CompareTenantModal />
        <EnvCompareScreen />

        {/* Panduan mengikuti domain aktif: tenant_configurations vs pipeline_workflow_configurations */}
        <DocsModal isOpen={showDocsModal && configDomain === "tenant_config"} onClose={() => setShowDocsModal(false)} />
        <WorkflowDocsModal isOpen={showDocsModal && configDomain === "workflow_pipeline"} onClose={() => setShowDocsModal(false)} />
      </div>
    </StudioProvider>
  );
}
