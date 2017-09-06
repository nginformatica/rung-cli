import { spawn } from 'child_process';
import concat from 'concat-stream';
import Promise, { delay, promisify } from 'bluebird';
import {
    complement,
    equals,
    identity,
    is,
    join,
    map,
    multiply,
    split,
    takeWhile,
    when
} from 'ramda';

export const promisifyStream = fn => promisify((param, callback) => {
    fn(param, callback(null, _));
});

export function createStream(command, args = [], env = {}) {
    const task = spawn(command, args, { stdio: 'pipe', env });
    task.stdout.setEncoding('utf-8');

    return {
        once: promisifyStream(task.stdout.once.bind(task.stdout)),
        on: promisifyStream(task.stdout.on.bind(task.stdout)),
        write: promisifyStream(task.stdin.write.bind(task.stdin)),
        close: ~task.kill('SIGTERM'),
        process: ~task
    };
}

/**
 * Returns the visible characters from a byte array (represented as string)
 *
 * @param {String} byteArray
 * @return {String}
 */
export const clearAnsiEscapes = split('\n')
    & map(split('') & takeWhile(complement(equals('\u001b'))) & join(''))
    & join('\n');

/**
 * Ansi escape codes for keypress
 */
export const keyboard = {
    type: identity,
    wait: identity,
    press: {
        ENTER: '\x0D',
        DOWN: '\x1B\x5B\x42',
        UP: '\x1B\x5B\x41'
    }
};

/**
 * Tells Salete to keep calm for at max n seconds
 */
export const keepCalm = multiply(1000);

// Salete is lazy on Travis CI
const multiplier = process.env.FAST_TEST === '1' ? 1 : 2;

/**
 * Spawns Salete to work.
 * Creates an IO event loop to work on dynamic buffered input and output.
 * Receives a set of options to work:
 *
 * runs :: String[] - Command list to run
 * procrastionation :: Number - Default procrastination time
 * does :: String[] - Combo of commands
 * clear :: Boolean - Whether the output should be escape-free
 *
 * @param {Object} options - The options to Salete
 */
export default function salete({
    runs: [command, ...args],
    procrastination = 500,
    does = [],
    clear = false } = {}) {
    const stream = createStream(command, args);
    const task = stream.process();
    const eventLoop = ([head, ...tail]) => {
        if (head) {
            const interval = is(Number, head)
                ? delay(head * multiplier)
                : delay(procrastination * multiplier).tap(~stream.write(head));

            return interval.tap(~eventLoop(tail));
        }

        task.stdin.end();
    };

    eventLoop(does);
    return new Promise(concat & task.stdout.pipe)
        .then(when(~clear, clearAnsiEscapes));
}