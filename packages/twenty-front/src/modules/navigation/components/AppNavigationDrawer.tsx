import { useEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';

import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { SettingsNavigationDrawerItems } from '@/settings/components/SettingsNavigationDrawerItems';
import { SupportDropdown } from '@/support/components/SupportDropdown';
import {
  NavigationDrawer,
  NavigationDrawerProps,
} from '@/ui/navigation/navigation-drawer/components/NavigationDrawer';

import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { getImageAbsoluteURI } from '~/utils/image/getImageAbsoluteURI';

import { useIsSettingsPage } from '../hooks/useIsSettingsPage';
import { currentMobileNavigationDrawerState } from '../states/currentMobileNavigationDrawerState';

import { AdvancedSettingsToggle } from '@/ui/navigation/link/components/AdvancedSettingsToggle';
import { isNavigationDrawerExpandedState } from '@/ui/navigation/states/isNavigationDrawerExpanded';
import { MainNavigationDrawerItems } from './MainNavigationDrawerItems';

export type AppNavigationDrawerProps = {
  className?: string;
};

export const AppNavigationDrawer = ({
  className,
}: AppNavigationDrawerProps) => {
  const isMobile = useIsMobile();
  const isSettingsPage = useIsSettingsPage();
  const currentMobileNavigationDrawer = useRecoilValue(
    currentMobileNavigationDrawerState,
  );
  const setIsNavigationDrawerExpanded = useSetRecoilState(
    isNavigationDrawerExpandedState,
  );
  const currentWorkspace = useRecoilValue(currentWorkspaceState);

  const isSettingsDrawer = isMobile
    ? currentMobileNavigationDrawer === 'settings'
    : isSettingsPage;

  const drawerProps: NavigationDrawerProps = isSettingsDrawer
    ? {
        isSubMenu: true,
        title: 'Exit Settings',
        children: <SettingsNavigationDrawerItems />,
        footer: <AdvancedSettingsToggle />,
      }
    : {
        logo:
          (currentWorkspace?.logo &&
            getImageAbsoluteURI(currentWorkspace.logo)) ??
          undefined,
        title: currentWorkspace?.displayName ?? undefined,
        children: <MainNavigationDrawerItems />,
        footer: <SupportDropdown />,
      };

  useEffect(() => {
    setIsNavigationDrawerExpanded(!isMobile);
  }, [isMobile, setIsNavigationDrawerExpanded]);

  return (
    <NavigationDrawer
      className={className}
      isSubMenu={drawerProps.isSubMenu}
      logo={drawerProps.logo}
      title={drawerProps.title}
      footer={drawerProps.footer}
    >
      {drawerProps.children}
    </NavigationDrawer>
  );
};
