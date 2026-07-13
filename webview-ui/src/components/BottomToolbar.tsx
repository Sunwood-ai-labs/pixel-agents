import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { isBrowserRuntime } from '../runtime.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
}

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
}: BottomToolbarProps) {
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;
  const showControls = isControlsOpen || isEditMode || isSettingsOpen;

  useEffect(() => {
    if (!isControlsOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isEditMode && !isSettingsOpen) {
        setIsControlsOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isControlsOpen, isEditMode, isSettingsOpen]);

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    transport.send({ type: 'launchAgent', folderPath: folder.path, bypassPermissions });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      transport.send({ type: 'launchAgent', bypassPermissions });
    }
  };

  return (
    <div
      className={`bottom-toolbar viewer-controls absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4 ${showControls ? 'is-expanded' : 'is-collapsed'}`}
    >
      <Button
        size="icon_lg"
        variant={showControls ? 'active' : 'ghost'}
        onClick={() => setIsControlsOpen((value) => !value)}
        aria-label={showControls ? 'Minimize controls' : 'Open controls'}
        aria-expanded={showControls}
        title={showControls ? 'Minimize controls' : 'Open controls'}
        className="viewer-controls-toggle"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <rect x="2" y="7" width="4" height="4" fill="currentColor" />
          <rect x="7" y="7" width="4" height="4" fill="currentColor" />
          <rect x="12" y="7" width="4" height="4" fill="currentColor" />
        </svg>
      </Button>

      {showControls && (
        <>
          {/* Hide + Agent in standalone browser mode (no terminal to interact with) */}
          {!isBrowserRuntime && (
            <div
              ref={folderPickerRef}
              className="relative"
              onMouseEnter={handleAgentHover}
              onMouseLeave={handleAgentLeave}
            >
              <Button
                variant="accent"
                onClick={handleAgentClick}
                className={
                  isFolderPickerOpen || isBypassMenuOpen
                    ? 'bg-accent-bright'
                    : 'bg-accent hover:bg-accent-bright'
                }
              >
                + Agent
              </Button>
              <Dropdown isOpen={isBypassMenuOpen}>
                <DropdownItem onClick={() => handleBypassSelect(true)}>
                  Skip permissions mode <span className="text-2xs text-warning">⚠</span>
                </DropdownItem>
              </Dropdown>
              <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
                {workspaceFolders.map((folder) => (
                  <DropdownItem
                    key={folder.path}
                    onClick={() => handleFolderSelect(folder)}
                    className="text-base"
                  >
                    {folder.name}
                  </DropdownItem>
                ))}
              </Dropdown>
            </div>
          )}
          <Button
            variant={isEditMode ? 'active' : 'default'}
            onClick={onToggleEditMode}
            title="Edit office layout"
          >
            Layout
          </Button>
          <Button
            variant={isSettingsOpen ? 'active' : 'default'}
            onClick={onToggleSettings}
            title="Settings"
          >
            Settings
          </Button>
        </>
      )}
    </div>
  );
}
