declare module 'tree-kill' {
  export default function treeKill(pid: number, signal?: string | number, callback?: (err?: Error) => void): void;
}
