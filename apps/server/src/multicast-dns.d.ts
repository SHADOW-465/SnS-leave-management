declare module 'multicast-dns' {
  interface Question {
    name?: string;
    type?: string;
  }
  interface Packet {
    questions?: Question[];
  }
  interface Mdns {
    on(event: 'query', cb: (query: Packet) => void): void;
    respond(message: { answers: unknown[] }): void;
    destroy(cb?: () => void): void;
  }
  function multicastDns(opts?: {
    reuseAddr?: boolean;
    loopback?: boolean;
    interface?: string;
  }): Mdns;
  export default multicastDns;
}
