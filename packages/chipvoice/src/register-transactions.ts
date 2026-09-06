import type {RegisterEvent} from './chip.js';

/** Driver output is a sequence of bus transactions, not freely sortable bytes.
 * A shared selector must remain paired with its data, including the PSG latch.
 * This only compiles generated commands; native register captures stay untouched. */
export class RegisterTransactions {
  private transactions: {at:number; events:RegisterEvent[]; gap:number}[]=[];
  constructor(private readonly chip:string) {}
  add(events:RegisterEvent[]):void {
    for(let i=0;i<events.length;i++){
      const first=events[i];
      const snes=this.chip==='snes'&&first.addr===0xf2;
      const fm=this.chip==='md'&&(first.addr===0xa04000||first.addr===0xa04002);
      const psg=this.chip==='md'&&first.addr===0xc00011&&(first.value&0x90)===0x80&&(first.value&0x60)!==0x60;
      if(snes||fm||psg){
        const second=events[++i];
        if(!second||second.at<first.at||second.addr!==(snes?0xf3:fm?first.addr+1:first.addr)||psg&&(second.value&128))throw new Error('Unpaired driver register transaction');
        const group=[first,second];
        // YM2612's FNUM high byte is a shared latch, committed by the low
        // byte. Keep both register pairs together, even across port banks.
        if(fm&&(first.value&0xfc)===0xa4){
          const low=events[++i],data=events[++i];
          if(!low||!data||low.addr!==first.addr||low.value!==first.value-4||data.addr!==second.addr)throw new Error('Unpaired FM frequency transaction');
          group.push(low,data);
        }
        this.transactions.push({at:first.at,events:group,gap:snes?5:fm?42*31:60});
      }else this.transactions.push({at:first.at,events:[first],gap:this.chip==='md'&&first.addr===0xc00011?60:1});
    }
  }
  finish():{events:RegisterEvent[];delayed:number;maxDelayCycles:number}{
    this.transactions.sort((a,b)=>a.at-b.at);
    const events:RegisterEvent[]=[];
    let free=0,delayed=0,maxDelayCycles=0;
    for(const transaction of this.transactions){
      const start=Math.max(transaction.at,free),delay=start-transaction.at;
      if(delay){delayed++;maxDelayCycles=Math.max(maxDelayCycles,delay);}
      for(const event of transaction.events)events.push(delay?{...event,at:event.at+delay}:event);
      // A byte consumes at least one cycle; multi-byte pairs keep their own
      // bus spacing. Sharing a bus prevents bank-port selector races as well.
      free=events[events.length-1].at+transaction.gap;
    }
    return {events,delayed,maxDelayCycles};
  }
}
