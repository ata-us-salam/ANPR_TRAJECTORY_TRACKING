from collections import defaultdict
import datetime

class TemporalVoting:
    """
    Maintains OCR reads for vehicle tracks and computes the best aggregated 
    plate string using temporal majority voting.
    """
    def __init__(self):
        # track_id -> list of dicts: {'text': str, 'conf': float, 'valid': bool, 'timestamp': datetime}
        self.track_history = defaultdict(list)
        
    def add_read(self, track_id: int, text: str, conf: float, is_valid: bool, timestamp: datetime.datetime = None):
        """
        Record a plate read for a given track ID.
        """
        if timestamp is None:
            timestamp = datetime.datetime.now()
            
        self.track_history[track_id].append({
            'text': text,
            'conf': conf,
            'valid': is_valid,
            'timestamp': timestamp
        })
        
    def get_best_plate(self, track_id: int) -> dict:
        """
        Returns the best aggregated plate read for a track_id.
        """
        history = self.track_history.get(track_id, [])
        if not history:
            return None
            
        # 1. Filter valid reads
        valid_reads = [h for h in history if h['valid']]
        
        # If we have valid reads, only vote among valid reads. 
        # Otherwise, fall back to all reads.
    def positional_character_voting(self, candidates: list) -> tuple[str, float]:
        """
        Computes character-level majority voting per position across multiple candidate reads.
        E.g. ['MH12VX7243', 'MH12VX724B', 'MH12VX7243'] -> 'MH12VX7243'
        """
        valid_texts = [c['text'].strip() for c in candidates if c.get('text', '').strip()]
        if not valid_texts:
            return None, 0.0

        # Cluster by most common length (typically 10 for standard Indian HSRP plates)
        lengths = [len(t) for t in valid_texts]
        most_common_len = max(set(lengths), key=lengths.count)
        filtered = [c for c in candidates if len(c.get('text', '').strip()) == most_common_len]

        if not filtered:
            return None, 0.0

        reconstructed_chars = []
        for pos in range(most_common_len):
            char_scores = defaultdict(float)
            for c in filtered:
                ch = c['text'].strip()[pos]
                # Confidence-weighted vote
                char_scores[ch] += max(0.25, float(c.get('conf', 0.5)))
            best_char = max(char_scores.keys(), key=lambda k: char_scores[k])
            reconstructed_chars.append(best_char)

        reconstructed_text = "".join(reconstructed_chars)
        avg_conf = sum(float(c.get('conf', 0.5)) for c in filtered) / max(1, len(filtered))
        return reconstructed_text, avg_conf

    def get_best_plate(self, track_id: int) -> dict:
        """
        Returns the best aggregated plate read for a track_id using positional character voting
        and frequency confidence ranking.
        """
        history = self.track_history.get(track_id, [])
        if not history:
            return None
            
        # 1. Filter valid reads if available
        valid_reads = [h for h in history if h.get('valid')]
        candidates = valid_reads if valid_reads else history
        
        if not candidates:
            return None

        # 2. Attempt character-level positional consensus across frames
        pos_text, pos_conf = self.positional_character_voting(candidates)
            
        # 3. Count whole-string frequencies
        freq = defaultdict(list)
        for cand in candidates:
            if cand.get('text'):
                freq[cand['text']].append(cand.get('conf', 0.5))
                
        if not freq and not pos_text:
            return None
            
        # Select best candidate
        best_text = pos_text if pos_text else None
        best_score = -1
        
        for text, confs in freq.items():
            count = len(confs)
            avg_conf = sum(confs) / count
            score = (count * 100) + avg_conf
            if score > best_score:
                best_score = score
                if not pos_text:
                    best_text = text

        if best_text:
            best_confs = freq.get(best_text, [pos_conf] if pos_conf else [0.75])
            final_conf = sum(best_confs) / max(1, len(best_confs))
            matching_timestamps = [c['timestamp'] for c in history if c.get('text') == best_text]
            first_seen = min(matching_timestamps) if matching_timestamps else history[0]['timestamp']
            last_seen = max(matching_timestamps) if matching_timestamps else history[-1]['timestamp']
            is_valid = any(c.get('valid') for c in history if c.get('text') == best_text)
            if not is_valid and valid_reads:
                is_valid = True
            
            return {
                'track_id': track_id,
                'plate_text': best_text,
                'confidence': round(final_conf, 3),
                'valid': is_valid,
                'reads_count': len(best_confs),
                'total_track_frames': len(history),
                'first_seen': first_seen,
                'last_seen': last_seen
            }
            
        return None

    def get_all_finalized_plates(self):
        """
        Returns the best plate for all tracks currently in history.
        """
        results = []
        for track_id in self.track_history.keys():
            best = self.get_best_plate(track_id)
            if best:
                results.append(best)
        return results
