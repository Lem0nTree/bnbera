import type pg from 'pg';
import type { MarketplaceSearchInput } from './marketplace-contract';

// Filter/count the catalog before loading expensive per-agent commerce projections.
export const directoryCatalogSql = `select distinct on(i.id) i.id,i.chain_id,i.agent_id,a.origin_type,a.verification_status,a.runtime_status,
 a.listing_status,eo.agent_version_id,eo.normalized_payload as profile,eo.source_timestamp,
 coalesce(eo.normalized_payload->>'category',v.public_metadata->>'category','uncategorized') as category
 from erc8004_identities i join agents a on a.identity_id=i.id join agent_versions v on v.agent_id=a.id
 join agent_enrichment_observations eo on eo.agent_version_id=v.id
 where eo.observation_type='registered_directory_v1' and eo.provider in('8004scan','bnbera-registry-review') and eo.validation_state='valid'
 and i.chain_id in(56,97) and i.read_consistency='finalized' and a.listing_status not in('delisted','suspended') and a.verification_status<>'rejected'
 and exists(select 1 from agent_discovery_sources s where s.identity_id=i.id and s.normalized_ingestion_version in ('bnbera-directory-v1','bnbera-directory-full-v1'))
 order by i.id,eo.source_timestamp desc,eo."createdAt" desc`;

export async function searchDirectoryCatalog(pool:pg.Pool,input:MarketplaceSearchInput,semantic?:{vector:readonly number[];provider:string;model:string;modelVersion:string;dimension:number;schema:string}) {
  const values:unknown[]=[];
  const bind=(v:unknown)=>{values.push(v);return `$${values.length}`;};
  const filters:string[]=[];
  const referenceId=process.env.T5_REFERENCE_PROVIDER_AGENT_ID;
  const reference=referenceId && /^[0-9]+$/u.test(referenceId) ? ` union all
    select i.id,i.chain_id,i.agent_id,a.origin_type,a.verification_status,a.runtime_status,a.listing_status,v.id,
      jsonb_build_object('name',v.public_metadata->>'name','description',v.public_metadata->>'description','protocols',coalesce(v.public_metadata->'protocols','[]'::jsonb),'scores','{}'::jsonb),
      i."updatedAt",coalesce(v.public_metadata->>'category','uncategorized')
    from erc8004_identities i join agents a on a.identity_id=i.id join agent_versions v on v.id=a.current_version_id
    where i.chain_id=97 and i.agent_id=${bind(referenceId)} and i.identity_registry=${bind(process.env.T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY??'')}
      and i.read_consistency='finalized' and a.listing_status='published' and a.verification_status='verified'
      and not exists(select 1 from snapshots where snapshots.id=i.id)` : '';

  if(input.chainId)filters.push(`d.chain_id=${bind(input.chainId)}`);
  if(input.category)filters.push(`d.category=${bind(input.category)}`);
  for(const [key,column] of [['origin','origin_type'],['verification','verification_status'],['runtime','runtime_status']] as const)
    if(input[key])filters.push(`d.${column}=${bind(input[key])}`);
  if(input.protocol)filters.push(`exists(select 1 from jsonb_array_elements_text(d.profile->'protocols') p where lower(p)=${bind(input.protocol.toLowerCase())})`);
  if(input.freshness)filters.push(`(case when d.source_timestamp>now()-interval '24 hours' then 'fresh' else 'stale' end)=${bind(input.freshness)}`);
  const text=`lower(concat_ws(' ',d.profile->>'name',d.profile->>'description',d.category,d.agent_id,d.profile->'protocols',d.profile->'skills',d.profile->'services',d.profile->'tags'))`;
  const tokens=(input.query??'').trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const lexical=tokens.length?tokens.map(token=>`strpos(${text},${bind(token)})>0`).join(' and '):'true';
  let join='',distance='null::double precision';
  if(semantic&&tokens.length) {
    const vec=bind(JSON.stringify(semantic.vector));
    join=`left join agent_listing_embeddings e on e.agent_version_id=d.agent_version_id and e.provider=${bind(semantic.provider)} and e.model=${bind(semantic.model)} and e.model_version=${bind(semantic.modelVersion)} and e.source_text_digest=d.profile->>'semanticDigest' and e.dimension=${bind(semantic.dimension)} and e.semantic_document_schema_version=${bind(semantic.schema)}`;
    distance=`e.embedding <=> ${vec}::vector`;
  }
  filters.push(`((${lexical})${join?` or (${distance})<0.55`:''})`);
  const ranked=`select d.*,(${lexical}) as lexical,${distance} as distance from catalog d ${join} where ${filters.join(' and ')}`;
  const order=input.sort==='freshness'?'source_timestamp desc,id':input.sort==='score'?"coalesce((profile->'scores'->>'overall')::float,-1) desc,id":`lexical desc,${join?'distance asc nulls last,':''}(listing_status='published' and verification_status='verified' and runtime_status='live') desc,coalesce((profile->'scores'->>'overall')::float,-1) desc,id`;
  const limit=bind(input.limit),offset=bind(input.offset??0);
  const result=await pool.query(`with snapshots as materialized (${directoryCatalogSql}), catalog as materialized (select * from snapshots ${reference}), ranked as (${ranked})
    select (select count(*)::int from ranked) as total,
      (select jsonb_agg(page.id) from (select id from ranked order by ${order} limit ${limit} offset ${offset}) page) as ids,
      (select count(*)::int from catalog) as registered,
      (select count(*)::int from catalog where chain_id=56) as mainnet,
      (select count(*)::int from catalog where chain_id=97) as testnet,
      (select count(*)::int from ranked where distance is not null) as vector_matches`,values);
  return result.rows[0] as {total:number;ids:string[]|null;registered:number;mainnet:number;testnet:number;vector_matches:number};
}
