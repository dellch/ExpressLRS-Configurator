import React, {FunctionComponent, memo, useEffect, useRef} from 'react';
import {makeStyles} from '@material-ui/core';

const useStyles = makeStyles(() => ({
  root: {
    minHeight: '500px',
    maxHeight: '500px',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  logs: {
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  }
}));

interface LogsProps {
  data: string;
}

const Logs: FunctionComponent<LogsProps> = memo(({data}) => {
  const styles = useStyles();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current !== null) {
      container.current.scrollTop = container.current.scrollHeight;
    }
  }, [data]);
  return (
    <div ref={container} className={styles.root}>
      <pre className={styles.logs}>
        <code>{data}</code>
      </pre>
    </div>
  )
});

export default Logs;
