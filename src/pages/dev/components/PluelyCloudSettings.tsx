import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLocation } from "react-router-dom";
import { GetLicense } from "@/components";
import { useApp } from "@/contexts";
import { PluelyApiSetup } from "./PluelyApiSetup";
import { Usage } from "./Usage";

function PluelyCloudControls() {
  const { hasActiveLicense } = useApp();
  const [activity, setActivity] = useState<any>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const fetchActivity = useCallback(async () => {
    if (!hasActiveLicense) {
      setActivity({ data: [], total_tokens_used: 0 });
      return;
    }
    setLoadingActivity(true);
    try {
      const response = await invoke("get_activity");
      const responseData: any = response;
      if (responseData && responseData.success) {
        setActivity(responseData);
      } else {
        setActivity({ data: [], total_tokens_used: 0 });
      }
    } catch (error) {
      setActivity({ data: [], total_tokens_used: 0 });
    } finally {
      setLoadingActivity(false);
    }
  }, [hasActiveLicense]);

  useEffect(() => {
    if (hasActiveLicense) {
      fetchActivity();
    } else {
      setActivity(null);
    }
  }, [fetchActivity, hasActiveLicense]);

  const activityData =
    activity && Array.isArray(activity.data) ? activity.data : [];
  const totalTokens =
    activity && typeof activity.total_tokens_used === "number"
      ? activity.total_tokens_used
      : 0;

  return (
    <div className="space-y-6 pb-4">
      <PluelyApiSetup />

      {hasActiveLicense ? (
        <Usage
          loading={loadingActivity}
          onRefresh={fetchActivity}
          data={activityData}
          totalTokens={totalTokens}
        />
      ) : (
        <GetLicense />
      )}
    </div>
  );
}

export function PluelyCloudSettings() {
  const { hash } = useLocation();
  const panelRef = useRef<HTMLDetailsElement>(null);
  const [hasOpened, setHasOpened] = useState(hash === "#pluely-cloud");

  useEffect(() => {
    if (hash === "#pluely-cloud" && panelRef.current) {
      panelRef.current.open = true;
    }
  }, [hash]);

  return (
    <details
      id="pluely-cloud"
      ref={panelRef}
      className="rounded-xl border border-input/50 px-4"
      onToggle={(event) => {
        if (event.currentTarget.open) setHasOpened(true);
      }}
    >
      <summary className="cursor-pointer rounded-md py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        Pluely 云端服务
      </summary>
      {hasOpened && <PluelyCloudControls />}
    </details>
  );
}
