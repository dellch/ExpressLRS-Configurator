import React, { FunctionComponent, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  makeStyles,
  Tooltip,
} from '@material-ui/core';
import SettingsIcon from '@material-ui/icons/Settings';
import { ipcRenderer } from 'electron';
import Header from '../../components/Header';
import FirmwareVersionForm from '../../components/FirmwareVersionForm';
import DeviceTargetForm from '../../components/DeviceTargetForm';
import DeviceOptionsForm, {
  DeviceOptionsFormData,
} from '../../components/DeviceOptionsForm';
import Sidebar from '../../components/Sidebar';
import ShowAlerts from '../../components/ShowAlerts';
import CardTitle from '../../components/CardTitle';
import EventsBatcher from '../../library/EventsBatcher';
import Logs from '../../components/Logs';
import BuildProgressBar from '../../components/BuildProgressBar';
import BuildNotificationsList from '../../components/BuildNotificationsList';
import {
  BuildFlashFirmwareInput,
  BuildJobType,
  BuildProgressNotification,
  DeviceTarget,
  FirmwareSource,
  FirmwareVersionDataInput,
  useBuildFlashFirmwareMutation,
  useBuildLogUpdatesSubscription,
  useBuildProgressNotificationsSubscription,
  UserDefinesMode,
  useTargetDeviceOptionsLazyQuery,
} from '../../gql/generated/types';
import Loader from '../../components/Loader';
import BuildResponse from '../../components/BuildResponse';
import {
  IpcRequest,
  OpenFileLocationRequestBody,
  UpdateBuildStatusRequestBody,
} from '../../../ipc';
import UserDefinesValidator from './UserDefinesValidator';
import ApplicationStorage from '../../storage';
import persistDeviceOptions from '../../storage/commands/persistDeviceOptions';
import mergeWithDeviceOptionsFromStorage from '../../storage/commands/mergeWithDeviceOptionsFromStorage';
import UserDefinesAdvisor from '../../components/UserDefinesAdvisor';
import SerialDeviceSelect from '../../components/SerialDeviceSelect';

export const validateFirmwareVersionData = (
  data: FirmwareVersionDataInput
): Error[] => {
  const errors: Error[] = [];
  switch (data.source) {
    case FirmwareSource.Local:
      if (!(data.localPath && data.localPath.length > 0)) {
        errors.push(new Error('Local path is empty'));
      }
      break;
    case FirmwareSource.GitCommit:
      if (!(data.gitCommit && data.gitCommit.length > 0)) {
        errors.push(new Error('Git commit hash is empty'));
      }
      break;
    case FirmwareSource.GitBranch:
      if (!(data.gitBranch && data.gitBranch.length > 0)) {
        errors.push(new Error('Git branch is not selected'));
      }
      break;
    case FirmwareSource.GitTag:
      if (!(data.gitTag && data.gitTag.length > 0)) {
        errors.push(new Error('Firmware release is not selected'));
      }
      break;
    default:
      throw new Error(`unknown firmware data source: ${data.source}`);
  }
  return errors;
};

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
  },
  main: {
    marginTop: theme.spacing(4),
    marginBottom: theme.spacing(4),
  },
  content: {
    flexGrow: 1,
  },
  button: {
    marginRight: `${theme.spacing(2)} !important`,
  },
  longBuildDurationWarning: {
    marginBottom: theme.spacing(1),
  },
  buildResponse: {
    marginBottom: theme.spacing(1),
  },
  tooltip: {
    paddingLeft: '1em',
    paddingRight: '1em',
    fontSize: '1.4em !important',
    '& a': {
      color: '#90caf9',
    },
  },
}));

enum ViewState {
  Configuration = 'CONFIGURATION',
  Compiling = 'https://xkcd.com/303/',
}

const ConfiguratorView: FunctionComponent = () => {
  const styles = useStyles();

  const [viewState, setViewState] = useState<ViewState>(
    ViewState.Configuration
  );

  const [progressNotifications, setProgressNotifications] = useState<
    BuildProgressNotification[]
  >([]);
  const progressNotificationsRef = useRef<BuildProgressNotification[]>([]);
  const [
    lastProgressNotification,
    setLastProgressNotification,
  ] = useState<BuildProgressNotification | null>(null);

  useBuildProgressNotificationsSubscription({
    onSubscriptionData: (options) => {
      const args = options.subscriptionData.data?.buildProgressNotifications;
      if (args !== undefined) {
        const newNotificationsList = [
          ...progressNotificationsRef.current,
          args,
        ];
        progressNotificationsRef.current = newNotificationsList;
        setProgressNotifications(newNotificationsList);
        setLastProgressNotification(args);
      }
    },
  });

  /*
    We batch log events in order to save React.js state updates and rendering performance.
   */
  const [logs, setLogs] = useState<string>('');
  const logsRef = useRef<string[]>([]);
  const eventsBatcherRef = useRef<EventsBatcher<string> | null>(null);
  useEffect(() => {
    eventsBatcherRef.current = new EventsBatcher<string>(200);
    eventsBatcherRef.current.onBatch((newLogs) => {
      const newLogsList = [...logsRef.current, ...newLogs];
      logsRef.current = newLogsList;
      setLogs(newLogsList.join(''));
    });
  }, []);
  useBuildLogUpdatesSubscription({
    fetchPolicy: 'network-only',
    onSubscriptionData: (options) => {
      const args = options.subscriptionData.data?.buildLogUpdates.data;
      if (args !== undefined && eventsBatcherRef.current !== null) {
        eventsBatcherRef.current.enqueue(args);
      }
    },
  });

  const [
    firmwareVersionData,
    setFirmwareVersionData,
  ] = useState<FirmwareVersionDataInput | null>(null);
  const [firmwareVersionErrors, setFirmwareVersionErrors] = useState<Error[]>(
    []
  );
  const onFirmwareVersionData = (data: FirmwareVersionDataInput) => {
    setFirmwareVersionErrors([]);
    setFirmwareVersionData(data);
  };

  const [deviceTarget, setDeviceTarget] = useState<DeviceTarget | null>(null);
  const [deviceTargetErrors, setDeviceTargetErrors] = useState<Error[]>([]);
  const onDeviceTarget = (data: DeviceTarget | null) => {
    setDeviceTargetErrors([]);
    setDeviceTarget(data);
  };

  const [
    deviceOptionsFormData,
    setDeviceOptionsFormData,
  ] = useState<DeviceOptionsFormData>({
    userDefinesTxt: '',
    userDefinesMode: UserDefinesMode.UserInterface,
    userDefineOptions: [],
  });
  const [
    fetchOptions,
    {
      loading: loadingOptions,
      data: deviceOptionsResponse,
      error: deviceOptionsResponseError,
    },
  ] = useTargetDeviceOptionsLazyQuery();

  useEffect(() => {
    if (
      deviceTarget === null ||
      firmwareVersionData === null ||
      validateFirmwareVersionData(firmwareVersionData).length > 0
    ) {
      setDeviceOptionsFormData({
        userDefinesTxt: '',
        userDefinesMode: UserDefinesMode.UserInterface,
        userDefineOptions: [],
      });
    } else {
      fetchOptions({
        variables: {
          target: deviceTarget,
          source: firmwareVersionData.source as FirmwareSource,
          gitBranch: firmwareVersionData.gitBranch!,
          gitTag: firmwareVersionData.gitTag!,
          gitCommit: firmwareVersionData.gitCommit!,
          localPath: firmwareVersionData.localPath!,
        },
      });
    }
  }, [deviceTarget, firmwareVersionData]);

  useEffect(() => {
    if (
      deviceOptionsResponse?.targetDeviceOptions?.length &&
      deviceOptionsResponse?.targetDeviceOptions?.length > 0
    ) {
      const handleUpdate = async () => {
        const storage = new ApplicationStorage();
        const userDefineOptions = await mergeWithDeviceOptionsFromStorage(
          storage,
          deviceTarget,
          {
            ...deviceOptionsFormData,
            userDefineOptions: [...deviceOptionsResponse.targetDeviceOptions],
          }
        );
        setDeviceOptionsFormData(userDefineOptions);
      };
      handleUpdate().catch((err) => {
        console.error(`failed to update device options form data: ${err}`);
      });
    }
  }, [deviceOptionsResponse]);

  const onResetToDefaults = () => {
    const handleReset = async () => {
      if (deviceOptionsResponse === undefined || deviceTarget === null) {
        // eslint-disable-next-line no-alert
        alert(`deviceOptionsResponse is undefined`);
        return;
      }

      const storage = new ApplicationStorage();
      await storage.removeDeviceOptions(deviceTarget);
      const userDefineOptions = await mergeWithDeviceOptionsFromStorage(
        storage,
        deviceTarget,
        {
          ...deviceOptionsFormData,
          userDefineOptions: [...deviceOptionsResponse.targetDeviceOptions],
        }
      );
      setDeviceOptionsFormData(userDefineOptions);
    };
    handleReset().catch((err) => {
      console.error(`failed to reset device options form data: ${err}`);
    });
  };

  const onUserDefines = (data: DeviceOptionsFormData) => {
    setDeviceOptionsFormData(data);
    if (deviceTarget !== null) {
      const storage = new ApplicationStorage();
      persistDeviceOptions(storage, deviceTarget, data).catch((err) => {
        console.error(`failed to persist user defines: ${err}`);
      });
    }
  };

  const [
    buildFlashFirmwareMutation,
    {
      loading: buildInProgress,
      data: response,
      error: buildFlashErrorResponse,
    },
  ] = useBuildFlashFirmwareMutation();

  useEffect(() => {
    const arg = response?.buildFlashFirmware?.firmwareBinPath;
    if (arg !== undefined && arg !== null && arg?.length > 0) {
      const body: OpenFileLocationRequestBody = {
        path: arg,
      };
      ipcRenderer.send(IpcRequest.OpenFileLocation, body);
    }
  }, [response]);

  const [
    longBuildDurationWarning,
    setLongBuildDurationWarning,
  ] = useState<boolean>(false);
  const buildInProgressRef = useRef(buildInProgress);
  buildInProgressRef.current = buildInProgress;
  const slowBuildTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (buildInProgressRef.current) {
      slowBuildTimeoutRef.current = window.setTimeout(() => {
        setLongBuildDurationWarning(true);
      }, 15 * 1000);
    } else {
      setLongBuildDurationWarning(false);
      if (slowBuildTimeoutRef.current !== null) {
        clearTimeout(slowBuildTimeoutRef.current);
      }
    }
    return () => {
      if (slowBuildTimeoutRef.current !== null) {
        clearTimeout(slowBuildTimeoutRef.current);
      }
    };
  }, [buildInProgress]);

  const [luaScriptLocation, setLuaScriptLocation] = useState<string>('');
  useEffect(() => {
    const isTX = (item: DeviceTarget) => {
      return item.indexOf('_TX_') > -1;
    };
    if (
      deviceTarget === null ||
      firmwareVersionData === null ||
      !isTX(deviceTarget)
    ) {
      setLuaScriptLocation('');
      return;
    }

    switch (firmwareVersionData.source) {
      case FirmwareSource.Local:
        setLuaScriptLocation('');
        break;
      case FirmwareSource.GitCommit:
        setLuaScriptLocation(
          `https://raw.githubusercontent.com/ExpressLRS/ExpressLRS/${firmwareVersionData.gitCommit}/src/lua/ELRS.lua`
        );
        break;
      case FirmwareSource.GitBranch:
        setLuaScriptLocation(
          `https://raw.githubusercontent.com/ExpressLRS/ExpressLRS/${firmwareVersionData.gitBranch}/src/lua/ELRS.lua`
        );
        break;
      case FirmwareSource.GitTag:
        setLuaScriptLocation(
          `https://raw.githubusercontent.com/ExpressLRS/ExpressLRS/${firmwareVersionData.gitTag}/src/lua/ELRS.lua`
        );
        break;
      default:
        throw new Error(
          `unknown firmware data source: ${firmwareVersionData.source}`
        );
    }
  }, [deviceTarget, firmwareVersionData]);

  /*
    Display Electron.js confirmation dialog if user wants to shutdown the app
    when build is in progress.
   */
  useEffect(() => {
    const body: UpdateBuildStatusRequestBody = {
      buildInProgress: buildInProgressRef.current,
    };
    ipcRenderer.send(IpcRequest.UpdateBuildStatus, body);
  }, [buildInProgress]);

  const [serialDevice, setSerialDevice] = useState<string | null>(null);
  const onSerialDevice = (newSerialDevice: string | null) => {
    setSerialDevice(newSerialDevice);
  };

  const [
    deviceOptionsValidationErrors,
    setDeviceOptionsValidationErrors,
  ] = useState<Error[] | null>(null);

  const reset = () => {
    logsRef.current = [];
    progressNotificationsRef.current = [];
    setLogs('');
    setFirmwareVersionErrors([]);
    setDeviceTargetErrors([]);
    setDeviceOptionsValidationErrors([]);

    setProgressNotifications([]);
    setLastProgressNotification(null);
  };

  const onBack = () => {
    reset();
    setViewState(ViewState.Configuration);
  };

  const [currentJobType, setCurrentJobType] = useState<BuildJobType>(
    BuildJobType.Build
  );
  const sendJob = (type: BuildJobType) => {
    reset();
    setCurrentJobType(type);

    // Validate firmware source
    if (firmwareVersionData === null) {
      setFirmwareVersionErrors([new Error('Please select firmware source')]);
      return;
    }
    const sourceErrors = validateFirmwareVersionData(firmwareVersionData);
    if (sourceErrors.length > 0) {
      setFirmwareVersionErrors(sourceErrors);
      return;
    }

    // Validate device target
    if (deviceTarget === null) {
      setDeviceTargetErrors([new Error('Please select a device target')]);
      return;
    }

    // Validate device options
    if (deviceOptionsFormData === null) {
      setDeviceTargetErrors([
        new Error('Please configure your device options'),
      ]);
      return;
    }

    switch (deviceOptionsFormData.userDefinesMode) {
      case UserDefinesMode.Manual:
        break;
      case UserDefinesMode.UserInterface:
        const errs = new UserDefinesValidator().validate(
          deviceOptionsFormData.userDefineOptions
        );
        if (errs.length > 0) {
          setDeviceOptionsValidationErrors(errs);
          return;
        }
        break;
      default:
        break;
    }

    const input: BuildFlashFirmwareInput = {
      type,
      firmware: firmwareVersionData,
      target: deviceTarget,
      userDefinesTxt: deviceOptionsFormData.userDefinesTxt,
      userDefinesMode: deviceOptionsFormData.userDefinesMode,
      userDefines: deviceOptionsFormData.userDefineOptions.map((item) => ({
        key: item.key,
        value: item.value,
        enabled: item.enabled,
        enumValues: item.enumValues,
        type: item.type,
      })),
      serialDevice: serialDevice !== null ? serialDevice : undefined,
    };
    buildFlashFirmwareMutation({
      variables: {
        input,
      },
    });
    setViewState(ViewState.Compiling);
  };

  useEffect(() => {
    if (
      !buildInProgress &&
      response?.buildFlashFirmware?.success !== undefined
    ) {
      window.scrollTo(0, document.body.scrollHeight);
    }
  }, [buildInProgress, response]);

  const onBuild = () => sendJob(BuildJobType.Build);
  const onBuildAndFlash = () => sendJob(BuildJobType.BuildAndFlash);

  return (
    <main className={styles.root}>
      <Sidebar navigationEnabled={!buildInProgress} />
      <div className={styles.content}>
        <Header />
        <Container className={styles.main}>
          {viewState === ViewState.Configuration && (
            <Card>
              <CardTitle icon={<SettingsIcon />} title="Firmware version" />
              <Divider />
              <CardContent>
                <FirmwareVersionForm
                  onChange={onFirmwareVersionData}
                  data={firmwareVersionData}
                />
                <ShowAlerts severity="error" messages={firmwareVersionErrors} />
              </CardContent>
              <Divider />

              <CardTitle icon={<SettingsIcon />} title="Target" />
              <Divider />
              <CardContent>
                <DeviceTargetForm
                  currentTarget={deviceTarget}
                  onChange={onDeviceTarget}
                />
                {luaScriptLocation.length > 0 && (
                  <Button
                    href={luaScriptLocation}
                    target="_blank"
                    size="small"
                    download
                  >
                    Download LUA script
                  </Button>
                )}
                <ShowAlerts severity="error" messages={deviceTargetErrors} />
              </CardContent>
              <Divider />

              <CardTitle
                icon={<SettingsIcon />}
                title={
                  <>
                    Device options{' '}
                    {deviceOptionsFormData.userDefinesMode ===
                      UserDefinesMode.UserInterface &&
                      deviceTarget !== null &&
                      !loadingOptions && (
                        <Tooltip
                          placement="top"
                          arrow
                          title={
                            <div className={styles.tooltip}>
                              Reset device options to the recommended defaults
                              on this device target. Except for your custom
                              binding phrase.
                            </div>
                          }
                        >
                          <Button onClick={onResetToDefaults} size="small">
                            Reset
                          </Button>
                        </Tooltip>
                      )}
                  </>
                }
              />
              <Divider />
              <CardContent>
                {!loadingOptions && (
                  <DeviceOptionsForm
                    target={deviceTarget}
                    deviceOptions={deviceOptionsFormData}
                    onChange={onUserDefines}
                  />
                )}
                <ShowAlerts
                  severity="error"
                  messages={deviceOptionsResponseError}
                />
                <ShowAlerts
                  severity="error"
                  messages={deviceOptionsValidationErrors}
                />
                <Loader loading={loadingOptions} />
              </CardContent>
              <Divider />

              <CardTitle icon={<SettingsIcon />} title="Actions" />
              <Divider />
              <CardContent>
                <UserDefinesAdvisor
                  deviceOptionsFormData={deviceOptionsFormData}
                />

                <div>
                  {deviceTarget !== null &&
                    (deviceTarget.indexOf('_via_UART') > -1 ||
                      deviceTarget.indexOf('_BetaflightPassthrough') > -1) && (
                      <SerialDeviceSelect
                        serialDevice={serialDevice}
                        onChange={onSerialDevice}
                      />
                    )}
                  <Button
                    className={styles.button}
                    size="large"
                    variant="contained"
                    onClick={onBuild}
                  >
                    Build
                  </Button>
                  <Button
                    className={styles.button}
                    size="large"
                    variant="contained"
                    onClick={onBuildAndFlash}
                  >
                    Build & Flash
                  </Button>
                </div>
              </CardContent>
              <Divider />
            </Card>
          )}

          {viewState === ViewState.Compiling && (
            <Card>
              <CardTitle icon={<SettingsIcon />} title="Build" />
              <Divider />
              <CardContent>
                <BuildProgressBar
                  inProgress={buildInProgress}
                  jobType={currentJobType}
                  progressNotification={lastProgressNotification}
                />
                <BuildNotificationsList notifications={progressNotifications} />

                <ShowAlerts
                  severity="error"
                  messages={buildFlashErrorResponse}
                />
              </CardContent>

              {logs.length > 0 && (
                <>
                  <CardTitle icon={<SettingsIcon />} title="Logs" />
                  <Divider />
                  <CardContent>
                    {longBuildDurationWarning && (
                      <div className={styles.longBuildDurationWarning}>
                        <ShowAlerts
                          severity="warning"
                          messages="Sometimes builds take at least a few minutes. It is normal, especially for the first time builds."
                        />
                      </div>
                    )}
                    <Logs data={logs} />
                  </CardContent>
                  <Divider />
                </>
              )}
              {response !== undefined && (
                <>
                  <CardTitle icon={<SettingsIcon />} title="Result" />
                  <Divider />
                  <CardContent>
                    <div className={styles.buildResponse}>
                      <BuildResponse response={response?.buildFlashFirmware} />
                    </div>
                    {response?.buildFlashFirmware?.success &&
                      currentJobType === BuildJobType.Build && (
                        <>
                          <Alert severity="info">
                            <AlertTitle>Build notice</AlertTitle>
                            Firmware binary file was opened in the file explorer
                          </Alert>
                        </>
                      )}
                  </CardContent>
                  <Divider />
                </>
              )}
              {!buildInProgress && (
                <>
                  <CardTitle icon={<SettingsIcon />} title="Actions" />
                  <Divider />
                  <CardContent>
                    <Button
                      className={styles.button}
                      color="primary"
                      size="large"
                      variant="contained"
                      onClick={onBack}
                    >
                      Back
                    </Button>

                    <Button
                      className={styles.button}
                      size="large"
                      variant="contained"
                      onClick={onBuildAndFlash}
                    >
                      Retry
                    </Button>
                  </CardContent>
                </>
              )}
            </Card>
          )}
        </Container>
      </div>
    </main>
  );
};

export default ConfiguratorView;
